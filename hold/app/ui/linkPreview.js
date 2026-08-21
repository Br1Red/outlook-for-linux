let lastRawUrl = '';

function render(url) {
    if (!url) {
        tooltip.style.display = 'none';
        return;
    }

    lastRawUrl = url;

    tooltip.textContent = url;   // plain text, no HTML
    tooltip.style.display = 'flex';
}

window.linkPreview.onHover(({ url }) => render(url));
