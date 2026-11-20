const SENDER_PLACEHOLDER_RE = /\[\s*(?:your\s+name|sender\s+name|name)\s*\]/gi;

export function sanitizeGeneratedMessage(message, senderName = '') {
  let text = String(message || '').trim();
  const name = String(senderName || '').trim();

  if (name) {
    text = text.replace(SENDER_PLACEHOLDER_RE, name);
    text = text.replace(/\b(?:your\s+name|sender\s+name)\b/gi, (match, offset, source) => {
      const signature = source.slice(Math.max(0, offset - 20), offset).match(/(?:best|regards|sincerely|cheers|kind regards)[,\s]*$/i);
      return signature ? name : match;
    });
  } else {
    text = text.replace(SENDER_PLACEHOLDER_RE, '');
    text = text.replace(/\n[ \t]*(?:your\s+name|sender\s+name)\s*$/i, '');
    text = text.replace(/,\s*(?:your\s+name|sender\s+name)\s*$/i, '');
  }

  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
