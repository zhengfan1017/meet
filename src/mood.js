export const EMO_LABELS = [
  'warm', 'care', 'happy', 'excited',
  'curious', 'playful', 'think', 'cheer',
];

export const EMO_SPRITE = {
  warm: { file: '08-定稿吧', desc: '治愈/安抚' },
  care: { file: '05-这版够野', desc: '关心/叮嘱' },
  happy: { file: '07-甲方说好', desc: '开心/被夸' },
  excited: { file: '01-有灵感', desc: '兴奋/有灵感' },
  curious: { file: '03-换个角度', desc: '好奇/追问' },
  playful: { file: '02-拆开看', desc: '调皮/玩笑' },
  think: { file: '06-对齐一下', desc: '思考/认真' },
  cheer: { file: '04-再来一版', desc: '鼓励/打气' },
};

export const DEFAULT_EMO = 'think';

export function spritePath(emo, ext = 'gif') {
  const entry = EMO_SPRITE[emo] || EMO_SPRITE[DEFAULT_EMO];
  return `src/assets/sprite/${entry.file}.${ext}`;
}
