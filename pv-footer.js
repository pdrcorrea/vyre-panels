/* pv-footer.js — Rodapé unificado PontoView (logo + day/night + animação) */
(function () {
  const LOGO = "./assets/logo-pontoview.png";

  function isNight() {
    const h = new Date().getHours();
    return h >= 19 || h < 7;
  }

  function applyLogoOpacity(img) {
    img.style.opacity = isNight() ? "0.60" : "0.85";
  }

  // CSS do rodapé (uma vez só)
  if (!document.getElementById("pvFooterStyles")) {
    const style = document.createElement("style");
    style.id = "pvFooterStyles";
    style.textContent = `
      .pvFooter{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
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
      .pvFooterRight{
        font-size:12.5px;
        font-weight:800;
        color: var(--muted, rgba(15,27,45,.65));
        letter-spacing:.02em;
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
    document.head.appendChild(style);
  }

  // garante que existe um container de footer
  let footer = document.querySelector(".pvFooter");
  if (!footer) {
    footer = document.createElement("div");
    footer.className = "pvFooter";
    document.body.appendChild(footer);
  }

  // HTML padrão do rodapé
  footer.innerHTML = `
    <div class="pvFooterBrand">
      <img id="pvLogo" src="${LOGO}" alt="PontoView">
    </div>
    <div class="pvFooterRight" id="pvFooterRight">Atualizado: —</div>
  `;

  // animação sutil
  footer.classList.add("pvEnter");
  setTimeout(() => footer.classList.remove("pvEnter"), 700);

  // opacidade day/night
  const img = document.getElementById("pvLogo");
  applyLogoOpacity(img);
  setInterval(() => applyLogoOpacity(img), 60 * 1000);

  // função simples pra cada painel atualizar o texto
  window.PVFooterSet = function (text) {
    const el = document.getElementById("pvFooterRight");
    if (el) el.textContent = "Atualizado: " + text;
  };
})();
