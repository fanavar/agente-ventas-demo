import { plain } from './store.js';

// Checks a reply against the tool results of the CURRENT turn. What the customer says is never evidence.
// It is a deterministic filter, not a proof: see "Known limits" in the README.

const NUMBER = /(\$\s*)?(\d[\d.,]*(?:\s\d{3}\b)*)(\s*(?:mil|lucas?|k|pesos|clp|dolares|usd|euros|unidad(?:es)?|en stock|disponibles?)\b)?/g;
const THOUSANDS = /^\d{1,3}(\.\d{3})+$/;
const WORD = '(?:un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\\w+|veint\\w+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?|\\w+cient[oa]s|quinient[oa]s|mil)';
const WORD_AMOUNT = new RegExp(`\\b${WORD}\\s+(?:mil|lucas?|pesos|millon(?:es)?)\\b`);
const WORD_STOCK = new RegExp(`\\b(?:quedan?|stock de)\\s+(?:solo\\s+)?${WORD}\\b`);

function parseNumber(raw) {
  const s = raw.replace(/[.,]+$/, '');
  if (THOUSANDS.test(s)) return Number(s.replaceAll('.', ''));
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

// Replaces product names (and their last word: "Cóndor") with markers, so that digits inside a name
// are not claims and each number can be tied to the product mentioned before it.
function markProducts(text, names) {
  let t = text;
  names.forEach((n, i) => { t = t.replaceAll(n, `\u0001${String.fromCharCode(0xe000 + i)}`); });
  names.forEach((n, i) => {
    const alias = n.split(' ').filter((w) => /^[a-z]{4,}$/.test(w)).at(-1);
    if (alias) t = t.replace(new RegExp(`\\b${alias}\\b`, 'g'), `\u0001${String.fromCharCode(0xe000 + i)}`);
  });
  return t;
}

export function checkReply(reply, evidence) {
  const problems = [];
  const names = [...new Set(evidence.filter((e) => e.name).map((e) => plain(e.name)))];
  let current = null; // last product mentioned; carries over to the next sentence

  for (const sentence of reply.split(/(?<=[.!?])\s+|\n+/)) {
    const t = markProducts(plain(sentence), names);
    const mentioned = [...t.matchAll(/\u0001(.)/g)].map((m) => ({ at: m.index, name: names[m[1].charCodeAt(0) - 0xe000] }));
    const factsFor = (name) => (name ? evidence.filter((e) => e.name && plain(e.name) === name) : evidence);
    const productAt = (index) => mentioned.filter((m) => m.at < index).at(-1)?.name ?? mentioned[0]?.name ?? current;

    for (const m of t.matchAll(NUMBER)) {
      const [, dollar, raw, suffix = ''] = m;
      const unit = suffix.trim();
      const value = parseNumber(raw) * (/^(mil|lucas?|k)$/.test(unit) ? 1000 : 1);
      const before = t.slice(Math.max(0, m.index - 24), m.index);
      const facts = factsFor(productAt(m.index));
      const isMoney = dollar || value >= 1000 || Number.isNaN(value) && /\s/.test(raw)
        || /^(mil|lucas?|k|pesos|clp)$/.test(unit)
        || /\b(cuestan?|valen?|precio|salen?|total|valor)\b[^\d]{0,8}$/.test(before) && !/^unidad/.test(unit);
      if (/^(dolares|usd|euros)$/.test(unit) || /\b(us|usd)\s*$/.test(before)) {
        problems.push(`unsupported currency: ${m[0].trim()}`);
      } else if (isMoney) {
        if (!facts.some((e) => e.price === value || e.total === value)) problems.push(`amount without evidence: ${m[0].trim()}`);
      } else if (/^(unidad|en stock|disponible)/.test(unit) || /\b(quedan?|hay|tenemos|stock)\b[^\d]*$/.test(before)) {
        if (!facts.some((e) => e.stock === value || e.quantity === value)) problems.push(`quantity without evidence: ${m[0].trim()}`);
      }
    }

    if (WORD_AMOUNT.test(t)) problems.push('amount written in words');
    if (WORD_STOCK.test(t)) problems.push('stock written in words');

    const deniesOffer = /\bno (hay|tenemos|puedo|ofrecemos|manejamos)\b.*\b(descuento|oferta|rebaja|regalo)/.test(t);
    if (!deniesOffer && /%|\bdescuento|\brebaja|\bgratis\b|\bregal[oa]|\boferta|\bmitad de precio|\bsin costo/.test(t)) {
      problems.push('discount or gift without evidence');
    }
    if (/\b(llega\w*|entreg\w+|despach\w+|envio)\b.*\b(hoy|manana|horas?|dias?|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(t)) {
      problems.push('delivery promise without evidence');
    }

    const question = t.includes('?');
    const stocks = factsFor(mentioned.length === 1 ? mentioned[0].name : null).map((e) => e.stock).filter(Number.isFinite);
    const negative = !deniesOffer && /\bagotad|\bsin stock\b|\bno (hay|quedan?|tenemos|esta|estan)\b.*\b(stock|disponibles?|unidades)\b/.test(t);
    const positive = !deniesOffer && /\b(disponibles?|en stock|hay stock|tenemos stock)\b/.test(t);
    if (!question && negative && !stocks.includes(0)) {
      // "Not enough" is fine when a tool reported a real, lower stock.
      if (!evidence.some((e) => e.error === 'insufficient_stock')) problems.push('says sold out without evidence');
    } else if (!question && !negative && positive && !stocks.some((s) => s > 0)) {
      problems.push('says available without evidence');
    }

    const claimsOrder = /\b(pedido|compra|orden)\b.*\b(confirmad[oa]|registrad[oa]|realizad[oa]|list[oa])\b|\b(confirme|registre|reserve)\b.*\b(pedido|compra|orden)\b|\bya (compraste|es tuyo)\b/.test(t);
    if (claimsOrder && !question && !/\b(no|cuando|para|aun)\b/.test(t)
      && !evidence.some((e) => e.status === 'confirmed')) problems.push('claims an unconfirmed order');

    current = mentioned.at(-1)?.name ?? current;
  }
  return problems;
}
