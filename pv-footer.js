/* pv-footer.js — Rodapé unificado PontoView (day/night + animação) */

(function () {
  const DEFAULTS = {
    logo: "./assets/logo-pontoview.png",
    rightPrefix: "Atualizado:",
    brandTitle: "PontoView",
  };

  function isNight() {
    const h = new Date().getHours();
    return h >= 19 || h < 7;
  }

  function applyLogoOpacity(img) {
    // day: 0.82 / night: 0.62 (mais discreto à noite)
    img.style.opacity = isNight() ? "0.62" : "0.82";
  }

  function injectCssOnce() {
    if (document.getElementById("pvFooterStyles")) return;

    const style = document.createElement("style");
    style.id = "pvFooterStyles";
    style.textContent = `
      .pvFooter{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        padding:12px 18px;
        border-top: 1px solid rgba(0,0,0,.08);
      }

      /* quando existir variável --line (vyre-light.css), usa ela */
      .pvFooter{
        border-top-color: var(--line, rgba(0,0,0,.08));
      }

      .pvFooterBrand{
        display:flex;
        align-items:center;
        gap:10px;
        min-width: 140px;
      }
      .pvFooterBrand img{
        height: 22px;
        width: auto;
        transition: opacity .35s ease;
      }

      .pvFooterRight{
        font-size:12.5px;
        font-weight:700;
        color: var(--muted, rgba(15,27,45,.65));
        letter-spacing: .02em;
      }

      /* animação sutil de entrada */
      .pvEnter{
        animation: pvEnter .35s ease-out both;
      }
      @keyframes pvEnter{
        from{ opacity:0; transform: translateY(6px); }
        to  { opacity:1; transform: none; }
      }

      /* se o painel usa footer mais escuro (tema antigo), ainda fica ok */
      @media (prefers-reduced-motion: reduce){
        .pvEnter{ animation:none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureFooter(opts) {
    injectCssOnce();

    const cfg = { ...DEFAULTS, ...(opts || {}) };

    // Procura um footer existente, senão cria no fim do body
    let footer = document.querySelector(".pvFooter");
    if (!footer) {
      footer = document.createElement("div");
      footer.className = "pvFooter";
      document.body.appendChild(footer);
    }

    // estrutura padrão
    footer.innerHTML = `
      <div class="pvFooterBrand">
        <img src="${cfg.logo}" alt="${cfg.brandTitle}">
      </div>
      <div class="pvFooterRight" id="pvFooterRight">${cfg.rightPrefix} —</div>
    `;

    // opacidade dinâmica day/night
    const img = footer.querySelector("img");
    applyLogoOpacity(img);
    setInterval(() => applyLogoOpacity(img), 60 * 1000);

    // animação sutil
    footer.classList.add("pvEnter");
    setTimeout(() => footer.classList.remove("pvEnter"), 600);

    // API global simples (para as páginas atualizarem o texto)
    window.PVFooter = {
      setRight(text) {
        const el = document.getElementById("pvFooterRight");
        if (el) el.textContent = `${cfg.rightPrefix} ${text}`;
      },
      setLogo(path) {
        const im = footer.querySelector("img");
        if (im) {
          im.src = path;
          applyLogoOpacity(im);
        }
      }
    };
  }

  // Auto-init
  ensureFooter();
})();
