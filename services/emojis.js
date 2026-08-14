// ============================================================
//  Deteccion de emoji animado por nombre de producto.
//  productIcon()      -> ID del emoji animado (para el boton de la tienda)
//  productTextEmoji() -> { emoji, id } (para titulos en descripciones)
//  Si el producto tiene un 'emoji' propio en Supabase, ese tiene prioridad.
// ============================================================
require("dotenv").config();

const ICON_LIGHTNING = process.env.ICON_LIGHTNING;

// ID del emoji animado para el boton del producto en la tienda
function productIcon(name) {
  const clean = String(name || "").toLowerCase();

  // Productos agregados despues (planes anuales con cupon, IA y redes).
  // Van arriba para que ninguna palabra mas general se los quede antes.
  if (clean.includes("leonardo")) return process.env.ICON_LEONARDOAI || ICON_LIGHTNING;
  if (clean.includes("runway")) return process.env.ICON_RUNWAY || ICON_LIGHTNING;
  if (clean.includes("gamma")) return process.env.ICON_GAMMAPRO || ICON_LIGHTNING;
  if (clean.includes("replit")) return process.env.ICON_REPLITCORE || ICON_LIGHTNING;
  if (clean.includes("wispr") || clean.includes("wisper")) return process.env.ICON_WISPRFLOW || ICON_LIGHTNING;
  if (clean.includes("framer")) return process.env.ICON_FRAMERPRO || ICON_LIGHTNING;
  if (clean.includes("gumloop")) return process.env.ICON_GUMLOOP || ICON_LIGHTNING;
  if (clean.includes("warp")) return process.env.ICON_WARPBUILD || ICON_LIGHTNING;

  // Seguidores / redes sociales: los productos se llaman "1K Followers IG"
  // y "1K Followers TK", asi que hay que reconocer las abreviaturas.
  if (clean.includes("followers") || clean.includes("seguidores")) {
    if (clean.includes("tiktok") || clean.includes("tik tok") || /\bt[kt]\b/.test(clean)) return process.env.ICON_TIKTOK || ICON_LIGHTNING;
    if (clean.includes("spotify") || /\bsp\b/.test(clean)) return process.env.ICON_SPOTIFY || ICON_LIGHTNING;
    if (clean.includes("youtube") || /\byt\b/.test(clean)) return process.env.ICON_YOUTUBE || ICON_LIGHTNING;
    return process.env.ICON_INSTAGRAM || ICON_LIGHTNING;
  }

  if (clean.includes("esim")) return process.env.ICON_ESIM || ICON_LIGHTNING;
  if (clean.includes("nitro") || clean.includes("discord")) return process.env.ICON_DISCORD || ICON_LIGHTNING;
  if (clean.includes("heygen")) return process.env.ICON_HEYGEN || ICON_LIGHTNING;
  if (clean.includes("apple")) return process.env.ICON_APPLETV || ICON_LIGHTNING;
  if (clean.includes("genie")) return process.env.ICON_GENIEIA || ICON_LIGHTNING;
  if (clean.includes("higgsfield")) return process.env.ICON_HIGGSFIELD || ICON_LIGHTNING;
  if (clean.includes("netflix")) return process.env.ICON_NETFLIX || ICON_LIGHTNING;
  if (clean.includes("codex")) return process.env.ICON_CHATGPT || ICON_LIGHTNING;
  if (clean.includes("crunchyroll")) return process.env.ICON_CRUNCHYROLL || ICON_LIGHTNING;
  if (clean.includes("directv")) return process.env.ICON_DIRECTVGO || ICON_LIGHTNING;
  if (clean.includes("hotmail") || clean.includes("outlook")) return process.env.ICON_HOTMAIL || ICON_LIGHTNING;
  if (clean.includes("google ai")) return process.env.ICON_GOOGLEIA || process.env.ICON_GOOGLE || ICON_LIGHTNING;
  if (clean.includes("gmail") || clean.includes("google")) return process.env.ICON_GOOGLE || ICON_LIGHTNING;
  if (clean.includes("paramount")) return process.env.ICON_PARAMOUNT || ICON_LIGHTNING;
  if (clean.includes("disney")) return process.env.ICON_DISNEY || ICON_LIGHTNING;
  if (clean.includes("prime")) return process.env.ICON_PRIMEVIDEO || ICON_LIGHTNING;
  if (clean.includes("amazon")) return process.env.ICON_AMAZON || ICON_LIGHTNING;
  if (clean.includes("lovable")) return process.env.ICON_LOVABLE || ICON_LIGHTNING;
  if (clean.includes("claude")) return process.env.ICON_CLAUDE || ICON_LIGHTNING;
  if (clean.includes("gemini")) return process.env.ICON_GEMINI || process.env.ICON_GOOGLE || ICON_LIGHTNING;
  if (clean.includes("chatgpt") || clean.includes("gpt")) return process.env.ICON_CHATGPT || ICON_LIGHTNING;
  if (clean.includes("youtube")) return process.env.ICON_YOUTUBE || ICON_LIGHTNING;
  if (clean.includes("nord")) return process.env.ICON_NORDVPN || ICON_LIGHTNING;
  if (clean.includes("supergrok") || clean.includes("grok")) return process.env.ICON_SUPERGROK || ICON_LIGHTNING;
  if (clean.includes("surfshark") || clean.includes("vpn key")) return process.env.ICON_SURFSHARK || ICON_LIGHTNING;
  if (clean.includes("express") && clean.includes("vpn")) return process.env.ICON_EXPRESSVPN || ICON_LIGHTNING;
  if (clean.includes("fast") && clean.includes("vpn")) return process.env.ICON_FASTVPN || ICON_LIGHTNING;
  if (clean.includes("capcut")) return process.env.ICON_CAPCUT || ICON_LIGHTNING;
  if (clean.includes("quillbot")) return process.env.ICON_QUILLBOT || ICON_LIGHTNING;
  if (clean.includes("factory")) return process.env.ICON_FACTORY || ICON_LIGHTNING;
  if (clean.includes("cursor")) return process.env.ICON_CURSORPRO || ICON_LIGHTNING;
  if (clean.includes("notion")) return process.env.ICON_NOTION || ICON_LIGHTNING;
  if (clean.includes("supabase")) return process.env.ICON_SUPABASE || ICON_LIGHTNING;
  if (clean.includes("canva")) return process.env.ICON_CANVA || ICON_LIGHTNING;
  if (clean.includes("elevenlabs")) return process.env.ICON_ELEVENLABS || ICON_LIGHTNING;
  if (clean.includes("perplexity")) return process.env.ICON_PERPLEXITY || ICON_LIGHTNING;
  if (clean.includes("n8n")) return process.env.ICON_N8N || ICON_LIGHTNING;
  if (clean.includes("manus")) return process.env.ICON_MANUS || ICON_LIGHTNING;
  if (clean.includes("virtual card") || clean.includes("vvc")) return process.env.ICON_VVCVIRTUAL || ICON_LIGHTNING;
  if (clean.includes("linkedin")) return process.env.ICON_LINKEDIN || ICON_LIGHTNING;
  if (clean.includes("coursera")) return process.env.ICON_COURSERA || ICON_LIGHTNING;
  if (clean.includes("duolingo")) return process.env.ICON_DUOLINGO || ICON_LIGHTNING;
  if (clean.includes("photoshop")) return process.env.ICON_PHOTOSHOP || ICON_LIGHTNING;
  if (clean.includes("adobe")) return process.env.ICON_ADOBECREATIVE || ICON_LIGHTNING;
  if (clean.includes("spotify")) return process.env.ICON_SPOTIFY || ICON_LIGHTNING;
  if (clean.includes("max plan")) return process.env.ICON_MAXSTANDAR || ICON_LIGHTNING;
  if (clean.includes("kiro")) return process.env.ICON_KIROPRO || ICON_LIGHTNING;

  return ICON_LIGHTNING;
}

// { emoji, id } para titulos en textos / descripciones
function productTextEmoji(name) {
  const clean = String(name || "").toLowerCase();

  // Productos agregados despues. El emoji que va aqui es el emoji BASE REAL
  // del sticker: si se pone otro, Telegram lo renderiza mal.
  if (clean.includes("leonardo")) return { emoji: "🇳🇨", id: process.env.ICON_LEONARDOAI };
  if (clean.includes("runway")) return { emoji: "😌", id: process.env.ICON_RUNWAY };
  if (clean.includes("gamma")) return { emoji: "🤔", id: process.env.ICON_GAMMAPRO };
  if (clean.includes("replit")) return { emoji: "😥", id: process.env.ICON_REPLITCORE };
  if (clean.includes("wispr") || clean.includes("wisper")) return { emoji: "🤓", id: process.env.ICON_WISPRFLOW };
  if (clean.includes("framer")) return { emoji: "🙂‍↔️", id: process.env.ICON_FRAMERPRO };
  if (clean.includes("gumloop")) return { emoji: "😖", id: process.env.ICON_GUMLOOP };
  if (clean.includes("warp")) return { emoji: "😘", id: process.env.ICON_WARPBUILD };

  if (clean.includes("followers") || clean.includes("seguidores")) {
    if (clean.includes("tiktok") || clean.includes("tik tok") || /\bt[kt]\b/.test(clean)) return { emoji: "🎸", id: process.env.ICON_TIKTOK };
    if (clean.includes("spotify") || /\bsp\b/.test(clean)) return { emoji: "🎧", id: process.env.ICON_SPOTIFY };
    if (clean.includes("youtube") || /\byt\b/.test(clean)) return { emoji: "🖥", id: process.env.ICON_YOUTUBE };
    return { emoji: "🕊", id: process.env.ICON_INSTAGRAM };
  }

  if (clean.includes("esim")) return { emoji: "\u0030\uFE0F\u20E3", id: process.env.ICON_ESIM };
  if (clean.includes("nitro") || clean.includes("discord")) return { emoji: "\uD83D\uDCF1", id: process.env.ICON_DISCORD };
  if (clean.includes("heygen")) return { emoji: "\uD83D\uDE0A", id: process.env.ICON_HEYGEN };
  if (clean.includes("apple")) return { emoji: "\uD83D\uDCFA", id: process.env.ICON_APPLETV };
  if (clean.includes("genie")) return { emoji: "\uD83C\uDDF3\uD83C\uDDE8", id: process.env.ICON_GENIEIA };
  if (clean.includes("higgsfield")) return { emoji: "\uD83E\uDD79", id: process.env.ICON_HIGGSFIELD };
  if (clean.includes("netflix")) return { emoji: "\uD83C\uDF7F", id: process.env.ICON_NETFLIX };
  if (clean.includes("codex")) return { emoji: "\uD83D\uDE3A", id: process.env.ICON_CHATGPT };
  if (clean.includes("crunchyroll")) return { emoji: "\u2692", id: process.env.ICON_CRUNCHYROLL };
  if (clean.includes("directv")) return { emoji: "\uD83C\uDDF3\uD83C\uDDE8", id: process.env.ICON_DIRECTVGO };
  if (clean.includes("hotmail") || clean.includes("outlook")) return { emoji: "\uD83D\uDEFB", id: process.env.ICON_HOTMAIL };
  if (clean.includes("paramount")) return { emoji: "\uD83D\uDCFA", id: process.env.ICON_PARAMOUNT };
  if (clean.includes("disney")) return { emoji: "\uD83D\uDCFA", id: process.env.ICON_DISNEY };
  if (clean.includes("prime")) return { emoji: "\uD83D\uDD35", id: process.env.ICON_PRIMEVIDEO };
  if (clean.includes("amazon")) return { emoji: "\uD83D\uDD25", id: process.env.ICON_AMAZON };
  if (clean.includes("lovable")) return { emoji: "\uD83D\uDE2E", id: process.env.ICON_LOVABLE };
  if (clean.includes("claude")) return { emoji: "\uD83E\uDD36", id: process.env.ICON_CLAUDE };
  if (clean.includes("google ai")) return { emoji: "\uD83C\uDF9A", id: process.env.ICON_GOOGLEIA };
  if (clean.includes("gemini")) return { emoji: "\uD83D\uDEF4", id: process.env.ICON_GEMINI || process.env.ICON_GOOGLE };
  if (clean.includes("chatgpt") || clean.includes("gpt")) return { emoji: "\uD83D\uDE3A", id: process.env.ICON_CHATGPT };
  if (clean.includes("supergrok") || clean.includes("grok")) return { emoji: "\uD83D\uDE01", id: process.env.ICON_SUPERGROK };
  if (clean.includes("surfshark") || clean.includes("vpn key")) return { emoji: "\uD83D\uDE2E", id: process.env.ICON_SURFSHARK };
  if (clean.includes("express") && clean.includes("vpn")) return { emoji: "\uD83D\uDC68\u200D\u2696", id: process.env.ICON_EXPRESSVPN };
  if (clean.includes("fast") && clean.includes("vpn")) return { emoji: "\uD83D\uDC25", id: process.env.ICON_FASTVPN };
  if (clean.includes("capcut")) return { emoji: "\uD83E\uDD16", id: process.env.ICON_CAPCUT };
  if (clean.includes("quillbot")) return { emoji: "\uD83D\uDFE2", id: process.env.ICON_QUILLBOT };
  if (clean.includes("factory")) return { emoji: "\uD83D\uDE17", id: process.env.ICON_FACTORY };
  if (clean.includes("cursor")) return { emoji: "\uD83D\uDE3A", id: process.env.ICON_CURSORPRO };
  if (clean.includes("notion")) return { emoji: "\uD83D\uDE19", id: process.env.ICON_NOTION };
  if (clean.includes("supabase")) return { emoji: "\uD83D\uDE0A", id: process.env.ICON_SUPABASE };
  if (clean.includes("canva")) return { emoji: "\u2764\uFE0F", id: process.env.ICON_CANVA };
  if (clean.includes("elevenlabs")) return { emoji: "\uD83D\uDC26", id: process.env.ICON_ELEVENLABS };
  if (clean.includes("perplexity")) return { emoji: "\u2764\uFE0F", id: process.env.ICON_PERPLEXITY };
  if (clean.includes("n8n")) return { emoji: "\uD83D\uDE0A", id: process.env.ICON_N8N };
  if (clean.includes("manus")) return { emoji: "\uD83D\uDE32", id: process.env.ICON_MANUS };
  if (clean.includes("gmail") || clean.includes("google")) return { emoji: "\uD83D\uDEF4", id: process.env.ICON_GOOGLE };
  if (clean.includes("youtube")) return { emoji: "\uD83D\uDDA5", id: process.env.ICON_YOUTUBE };
  if (clean.includes("nord")) return { emoji: "\uD83E\uDD4F", id: process.env.ICON_NORDVPN };
  if (clean.includes("virtual card") || clean.includes("vvc")) return { emoji: "💳", id: process.env.ICON_VVCVIRTUAL };
  if (clean.includes("linkedin")) return { emoji: "\uD83D\uDCF1", id: process.env.ICON_LINKEDIN };
  if (clean.includes("coursera")) return { emoji: "\u263A\uFE0F", id: process.env.ICON_COURSERA };
  if (clean.includes("duolingo")) return { emoji: "\uD83D\uDFE2", id: process.env.ICON_DUOLINGO };
  if (clean.includes("photoshop")) return { emoji: "\u2764\uFE0F", id: process.env.ICON_PHOTOSHOP };
  if (clean.includes("adobe")) return { emoji: "\uD83E\uDEE5", id: process.env.ICON_ADOBECREATIVE };
  if (clean.includes("spotify")) return { emoji: "\uD83C\uDFA7", id: process.env.ICON_SPOTIFY };
  if (clean.includes("max") && (clean.includes("plan") || clean.includes("standard") || clean.includes("estandar"))) return { emoji: "\uD83D\uDCF1", id: process.env.ICON_MAXSTANDAR };
  if (clean.includes("kiro")) return { emoji: "\uD83D\uDE02", id: process.env.ICON_KIROPRO };

  return { emoji: "🛍️", id: null };
}

module.exports = { productIcon, productTextEmoji };
