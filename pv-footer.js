/* ===== pv-footer.js (NOVO) =====
Crie este arquivo na raiz do seu repo: pv-footer.js
Rodapé unificado: SOMENTE logo + day/night + animação sutil
*/
(function () {
  const LOGO = "./assets/logo-pontoview.png";

  const css = `
    .pvFooter{
      display:flex;
      align-items:center;
      justify-content:flex-start;
      padding:12px 18px;
      border-top:1px solid var(--line, rgba(0,0,0,.12));
      background: transparent;
    }
    .pvFooterBrand{
      display:flex;
      align-items:center;
    }
    .pvFooterBrand img{
      height:22px;
      width:auto;
      transition: opacity .35s ease;
    }
    .pvEnter{
      animation: pvEnter .35s ease-out both;
    }
    @keyframes pvEnter{
      from{ opacity:0; transform: translateY(6px); }
      to{ opacity:1; transform:none; }
    }
    @media (prefers-reduced-motion: reduce){
      .pvEnter{ animation:none !important; }
    }
  `;

  function isNight() {
    const h = new Date().getHours();
    return h >= 19 || h < 7;
  }

  function applyOpacity(img) {
    img.style.opacity = isNight() ? "0.60" : "0.85";
  }

  // injeta CSS uma vez
  if (!document.getElementById("pvFooterStyles")) {
    const style = document.createElement("style");
    style.id = "pvFooterStyles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // garante container
  let footer = document.querySelector(".pvFooter");
  if (!footer) {
    footer = document.createElement("div");
    footer.className = "pvFooter";
    document.body.appendChild(footer);
  }

  footer.innerHTML = `
    <div class="pvFooterBrand">
      <img id="pvLogo" src="${LOGO}" alt="PontoView">
    </div>
  `;

  // animação sutil
  footer.classList.add("pvEnter");
  setTimeout(() => footer.classList.remove("pvEnter"), 700);

  // opacidade day/night
  const img = document.getElementById("pvLogo");
  applyOpacity(img);
  setInterval(() => applyOpacity(img), 60 * 1000);
})();
