(() => {
  const MARKUP = `
    <a class="pvMark" href="#" aria-label="PontoView">
      <svg viewBox="0 0 148 28" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="pvG" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stop-color="#2f6f9d"/>
            <stop offset="1" stop-color="#34c6d0"/>
          </linearGradient>
        </defs>
        <!-- ícone -->
        <rect x="1" y="1" width="26" height="26" rx="8" fill="url(#pvG)" opacity="0.92"/>
        <rect x="1" y="1" width="26" height="26" rx="8" fill="none" stroke="rgba(15,23,42,.18)"/>
        <path d="M9 18.8V9.2h4.2c2.2 0 3.6 1.2 3.6 3.1 0 2-1.4 3.2-3.6 3.2H11v3.3H9zm2-5.1h2c1.1 0 1.8-.5 1.8-1.4S14.1 11 13 11h-2v2.7z"
              fill="#fff" opacity="0.95"/>
        <!-- wordmark -->
        <text x="36" y="20" font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
              font-size="14" font-weight="900" letter-spacing=".02em" fill="rgba(15,23,42,.65)">
          PontoView
        </text>
      </svg>
    </a>
  `;

  const css = `
    .pvMark{ display:inline-flex; align-items:center; text-decoration:none; }
    .pvMark svg{ height:22px; width:auto; display:block; }
  `;

  function injectCSS(){
    if (document.getElementById("pvFooterCSS")) return;
    const s = document.createElement("style");
    s.id = "pvFooterCSS";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function dayNightOpacity(){
    const h = new Date().getHours();
    // dia: mais nítido / noite: mais discreto
    return (h >= 6 && h <= 18) ? 0.86 : 0.62;
  }

  function apply(){
    injectCSS();
    const holders = document.querySelectorAll(".pvFooter");
    holders.forEach(el => {
      el.innerHTML = MARKUP;
      el.style.opacity = dayNightOpacity();
    });
  }

  apply();
  // atualiza opacidade a cada minuto
  setInterval(apply, 60_000);
})();
