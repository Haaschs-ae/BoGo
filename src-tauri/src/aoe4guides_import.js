// Injecté dans la fenêtre aoe4guides.com : sur la page d'un build, affiche un panneau
// « Importer dans BoGo ». Le site n'a aucun accès à BoGo : le clic navigue vers
// https://bogo.import/<id>?style=<style>, adresse que BoGo intercepte et annule.
(() => {
  if (window.top !== window) return;
  const STYLES = [
    ["boom", "Boom"],
    ["agressif", "Agressif"],
    ["fast-castle", "Fast Castle"],
    ["autre", "Autre"],
  ];
  let panel = null;

  function buildId() {
    const match = location.pathname.match(/^\/builds\/([A-Za-z0-9]+)\/?$/);
    return match ? match[1] : null;
  }

  function update() {
    const id = buildId();
    if (!id || !document.body) {
      if (panel) panel.remove();
      panel = null;
      return;
    }
    if (panel && panel.dataset.id === id && panel.isConnected) return;
    if (panel) panel.remove();

    panel = document.createElement("div");
    panel.dataset.id = id;
    panel.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#141821;color:#e8e9ec;" +
      "border:1px solid #f2b632;border-radius:10px;padding:10px 12px;font:14px -apple-system,sans-serif;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.45)";
    const title = document.createElement("div");
    title.textContent = "Importer dans BoGo :";
    title.style.cssText = "margin-bottom:8px;font-weight:600;color:#f2b632";
    panel.append(title);
    for (const [style, label] of STYLES) {
      const button = document.createElement("button");
      button.textContent = label;
      button.style.cssText =
        "margin-right:6px;padding:4px 10px;border-radius:6px;border:1px solid #3a4152;" +
        "background:#232836;color:#e8e9ec;cursor:pointer;font:inherit";
      button.onclick = () => {
        title.textContent = `Envoyé à BoGo (${label}) ✓`;
        location.href = `https://bogo.import/${id}?style=${style}`;
      };
      panel.append(button);
    }
    document.body.append(panel);
  }

  // aoe4guides change de page sans recharger : on surveille l'adresse.
  setInterval(update, 500);
})();
