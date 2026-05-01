// 设计系统常量：字体、CSS、Design Tokens

const { FONT_STACK } = require('./fonts');

// 优先使用内嵌的 Inter + Noto Sans SC（见 fonts.js），避免容器/Linux 缺字体回退漂移。
// PingFang SC / system-ui 仅作为内嵌字体加载失败时的最后兜底。
const FONTS = FONT_STACK;

const SLIDE_CSS = `
*,*::before,*::after{box-sizing:border-box}*{margin:0;padding:0}
.slide{width:960px;height:540px;position:relative;overflow:hidden;font-family:var(--font-body);color:var(--text)}

/* immersive_cover */
.ic{display:flex;align-items:center}
.ic-content{position:relative;z-index:2;height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 80px;}
.ic-brand{font-size:13px;font-weight:500;color:var(--accent);letter-spacing:0.15em;text-transform:uppercase;margin-bottom:20px;}
.ic-title{font-size:56px;font-weight:900;line-height:1.1;letter-spacing:-0.02em;margin-bottom:16px;max-width:700px;}
.ic-subtitle{font-size:22px;color:rgba(255,255,255,0.72);line-height:1.5;margin-bottom:32px;max-width:600px;}
.ic-meta{display:flex;gap:24px;font-size:14px;color:rgba(255,255,255,0.5);}
.ic-accent-bar{position:absolute;left:0;top:0;bottom:0;width:4px;}
.ic-corner{position:absolute;border-radius:50%;}

/* bento_grid */
.bento{display:flex;flex-direction:column}
.bento-inner{position:relative;z-index:2;padding:40px 48px;height:100%;}
.bento-title{font-size:28px;font-weight:700;margin-bottom:28px;padding-bottom:16px;border-bottom:1px solid var(--border);}
.bento-grid{display:grid;gap:16px;}
.bento-2{grid-template-columns:repeat(2,1fr)}
.bento-3{grid-template-columns:repeat(3,1fr)}
.bento-4{grid-template-columns:repeat(4,1fr)}
.bento-card{display:flex;flex-direction:column;gap:12px;padding:24px;border-radius:var(--radius-lg);border:1px solid var(--border);}
.bc-tag{font-size:11px;font-weight:700;color:var(--accent);letter-spacing:0.1em;text-transform:uppercase;}
.bc-title{font-size:18px;font-weight:700;line-height:1.3;}
.bc-desc{font-size:13px;color:var(--text-muted);line-height:1.6;flex:1;}
.bc-metrics{display:flex;gap:16px;margin-top:8px;}
.bc-metrics>div{text-align:center}
.bc-metrics .dc-value{font-size:24px;font-weight:900;color:var(--primary)}

/* split_content */
.split{display:grid;grid-template-columns:1fr 1fr;height:100%}
.split-inner{position:relative;z-index:2;display:grid;grid-template-columns:1fr 1fr;height:100%}
.split-left,.split-right{padding:48px;display:flex;flex-direction:column;border-right:1px solid var(--border)}
.split-right{border-right:none}
.split h2{font-size:24px;font-weight:700;margin-bottom:20px}
.split ul{list-style:none;flex:1}

/* timeline_flow */
.timeline{display:flex;flex-direction:column}
.timeline-inner{position:relative;z-index:2;padding:40px 48px;height:100%;display:flex;flex-direction:column}
.timeline h2{font-size:26px;font-weight:700;margin-bottom:28px}
.timeline-row{display:flex;gap:16px;flex:1;align-items:stretch}
.tl-phase{flex:1;border-radius:var(--radius-lg);overflow:hidden;border:1px solid var(--border)}
.tl-phase-header{padding:12px 16px}
.tl-phase-header div:first-child{font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:4px}
.tl-phase-header div:last-child{font-size:15px;font-weight:700;color:#fff}
.tl-phase-body{padding:16px}
.tl-phase-body ul{list-style:none}
.tl-phase-body li{font-size:12px;line-height:1.6;padding:4px 0;padding-left:12px;position:relative}

/* minimal_text */
.minimal{display:flex;flex-direction:column}
.minimal-inner{position:relative;z-index:2;height:100%;display:flex;flex-direction:column;justify-content:center;padding:64px 96px}
.minimal h2{font-size:42px;font-weight:900;line-height:1.15;letter-spacing:-0.02em;margin-bottom:16px;max-width:700px}
.minimal p{font-size:15px;color:var(--text-muted);line-height:1.8;max-width:580px}
.minimal .highlight{margin-top:32px;padding:20px 24px;border-radius:var(--radius-md);border-left:3px solid var(--accent);max-width:520px}

/* data_cards */
.data{display:flex;flex-direction:column}
.data-inner{position:relative;z-index:2;padding:40px 48px;height:100%;display:flex;flex-direction:column;justify-content:center}
.data h2{font-size:26px;font-weight:700;margin-bottom:32px}
.data-grid{display:grid;gap:20px}
.dc-card{background:var(--surface);border-radius:var(--radius-lg);padding:24px;border:1px solid var(--border);text-align:center}
.dc-value{font-size:36px;font-weight:900;color:var(--primary);line-height:1;margin-bottom:8px}

/* image_statement */
.image-statement{display:grid;grid-template-columns:1.2fr .8fr;height:100%}
.is-copy,.is-visual{position:relative;z-index:2}

/* editorial_quote */
.editorial{display:grid;grid-template-columns:1.15fr .85fr;height:100%}

/* asymmetrical_story */
.story{display:grid;grid-template-columns:1.15fr .85fr;height:100%}

/* end_card */
.end{display:flex;flex-direction:column;align-items:center;justify-content:center}
.end-inner{position:relative;z-index:2;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:48px}
.end h1{font-size:56px;font-weight:900;line-height:1.1;margin-bottom:16px}
.end p{font-size:20px;color:rgba(255,255,255,0.62);margin-bottom:32px}
.end div{font-size:14px;color:rgba(255,255,255,0.4);letter-spacing:0.1em}

/* toc */
.toc{display:grid;grid-template-columns:240px 1fr;height:100%}
.toc-sidebar{background:var(--primary);padding:48px 32px;display:flex;flex-direction:column;justify-content:center}
.toc-sidebar .toc-label{font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:0.12em;text-transform:uppercase;margin-bottom:12px}
.toc-sidebar .toc-title{font-size:36px;font-weight:900;color:#fff;line-height:1.1}
.toc-sidebar .toc-line{width:32px;height:2px;background:rgba(255,255,255,0.3);margin-top:20px}
.toc-content{padding:48px 56px;display:flex;flex-direction:column;justify-content:center}
.toc-item{padding:12px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:16px}
.toc-item span:first-child{font-size:20px;font-weight:900;color:var(--primary);opacity:0.5;min-width:32px}
.toc-item span:last-child{font-size:15px;font-weight:500}

/* structured composition */
.structured{display:block}
.sc-canvas{position:absolute;inset:0;z-index:2;display:grid;align-content:start}
.sc-layer{position:relative;z-index:1;min-width:0;min-height:0}
.sc-region{position:relative;z-index:2;display:flex;min-width:0;min-height:0}
.sc-stack{display:flex;width:100%;min-height:100%;height:auto}
.sc-block{display:flex;flex-direction:column;min-width:0}
`;

const DESIGN_TOKENS = {
  dark_tech: {
    colors: {
      primary: '#2563EB',
      secondary: '#0F172A',
      accent: '#C0A062',
      bg: '#0A0F1A',
      bgAlt: '#111827',
      surface: '#1E293B',
      text: '#F8FAFC',
      textMuted: '#94A3B8',
      border: 'rgba(255,255,255,0.08)',
    },
    typography: {
      fontDisplay: FONTS,
      fontBody: FONTS,
      weightNormal: 400,
      weightMedium: 500,
      weightBold: 700,
      weightBlack: 800,
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64 },
    radius: { sm: 4, md: 8, lg: 16, xl: 24, full: 9999 },
    shadow: {
      sm: '0 2px 8px rgba(0,0,0,0.3)',
      md: '0 8px 24px rgba(0,0,0,0.4)',
      lg: '0 20px 48px rgba(0,0,0,0.5)',
      glow: '0 0 60px rgba(37,99,235,0.2)',
      accentGlow: '0 0 40px rgba(192,160,98,0.3)',
    },
  },
  light_minimal: {
    colors: {
      primary: '#2563EB',
      secondary: '#1E293B',
      accent: '#C0A062',
      bg: '#FFFFFF',
      bgAlt: '#F8FAFC',
      surface: '#F1F5F9',
      text: '#0F172A',
      textMuted: '#64748B',
      border: 'rgba(0,0,0,0.08)',
    },
    typography: {
      fontDisplay: FONTS,
      fontBody: FONTS,
      weightNormal: 400,
      weightMedium: 500,
      weightBold: 700,
      weightBlack: 800,
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64 },
    radius: { sm: 4, md: 8, lg: 16, xl: 24, full: 9999 },
    shadow: {
      sm: '0 1px 3px rgba(0,0,0,0.06)',
      md: '0 4px 12px rgba(0,0,0,0.08)',
      lg: '0 12px 32px rgba(0,0,0,0.12)',
      glow: '0 0 40px rgba(37,99,235,0.1)',
      accentGlow: '0 0 30px rgba(192,160,98,0.15)',
    },
  },
  warm_premium: {
    colors: {
      primary: '#92400E',
      secondary: '#1C1917',
      accent: '#D97706',
      bg: '#FAF7F2',
      bgAlt: '#F5F0E8',
      surface: '#FFFFFF',
      text: '#1C1917',
      textMuted: '#78716C',
      border: 'rgba(28,25,23,0.1)',
    },
    typography: {
      fontDisplay: FONTS,
      fontBody: FONTS,
      weightNormal: 400,
      weightMedium: 500,
      weightBold: 700,
      weightBlack: 800,
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64 },
    radius: { sm: 4, md: 8, lg: 16, xl: 24, full: 9999 },
    shadow: {
      sm: '0 1px 4px rgba(28,25,23,0.06)',
      md: '0 4px 16px rgba(28,25,23,0.1)',
      lg: '0 16px 40px rgba(28,25,23,0.12)',
      glow: '0 0 40px rgba(217,119,6,0.12)',
      accentGlow: '0 0 30px rgba(146,64,14,0.15)',
    },
  },
};

module.exports = { FONTS, SLIDE_CSS, DESIGN_TOKENS };
