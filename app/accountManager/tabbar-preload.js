/**
 * Preload script for tab bar in main tabbed window
 * Handles IPC communication between tab bar and main process
 */

const { ipcRenderer } = require("electron");

// Wait for DOM to be ready
document.addEventListener("DOMContentLoaded", () => {
	console.log("[TabBar Preload] DOM ready");
});

// Listen for tab updates from main process
ipcRenderer.on("update-tab-bar", (_event, data) => {
	console.log(
		"[TabBar UI] Received tabs:",
		data.tabs.map((t) => `${t.id}: "${t.displayName}"`),
	);
	window.updateTabs(data.tabs, data.activeTabId);
});

// Listen for tab activation from main process
ipcRenderer.on("tab-activated", (_event, tabId) => {
	console.log("[TabBar] Tab activated:", tabId);
	window.activateTab(tabId);
});

// Listen for tab close events from main process
ipcRenderer.on("close-tabs", (_event, tabIds) => {
	console.log("[TabBar] Closing tabs:", tabIds);
	tabIds.forEach((tabId) => window.removeTab(tabId));
});

// Handle tab close request
ipcRenderer.on("tab-close-request", (_event, tabId) => {
	console.log("[TabBar] Close request for tab:", tabId);
	ipcRenderer.invoke("close-tab", tabId);
});

// Handle tab switch request
ipcRenderer.on("tab-switch-request", (_event, tabId) => {
	console.log("[TabBar] Switch request for tab:", tabId);
	ipcRenderer.invoke("switch-tab", tabId);
});

// Export for tab bar HTML
window.updateTabs = function (tabs) {
	const tabList = document.getElementById("tabList");
	if (!tabList) return;

	console.log("[TabBar UI] Updating tabs:", tabs);
	console.log(
		"[TabBar UI] Tab details:",
		tabs.map((t) => ({ id: t.id, name: t.displayName })),
	);

	while (tabList.firstChild) {
		tabList.removeChild(tabList.firstChild);
	}

	tabs.forEach((tab) => {
		const tabEl = createTabElement(tab);
		tabList.appendChild(tabEl);
	});
};

window.activateTab = function (tabId) {
	const tabs = document.querySelectorAll(".tab");
	tabs.forEach((tab) => {
		if (tab.dataset.tabId === tabId) {
			tab.classList.add("active");
		} else {
			tab.classList.remove("active");
		}
	});
};

window.removeTab = function (tabId) {
	const tab = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
	if (tab) {
		// Find the parent list and remove from it
		const tabList = document.getElementById("tabList");
		if (tabList) {
			tabList.removeChild(tab);
		}
	}
};

function createSvg(namespace, tag, attributes) {
	const el = document.createElementNS(namespace, tag);
	for (const [key, value] of Object.entries(attributes)) {
		el.setAttribute(key, value);
	}
	return el;
}

function createTabElement(tab) {
	const tabEl = document.createElement("div");
	tabEl.className = `tab${tab.isActive ? " active" : ""}`;
	tabEl.dataset.tabId = tab.id;

	const ns = "http://www.w3.org/2000/svg";

	// Tab icon (using account avatar placeholder)
	const iconEl = document.createElement("div");
	iconEl.className = "tab-icon";
	const iconSvg = createSvg(ns, "svg", {
		class: "close-icon",
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		"stroke-width": "2",
	});
	iconSvg.appendChild(createSvg(ns, "circle", { cx: "12", cy: "12", r: "10" }));
	iconEl.appendChild(iconSvg);
	tabEl.appendChild(iconEl);

	// Tab name
	const nameEl = document.createElement("div");
	nameEl.className = "tab-name";
	nameEl.textContent =
		tab.displayName || `Account ${tab.id?.substring(0, 8) || ""}`;
	nameEl.title = tab.displayName || "New Account";
	tabEl.appendChild(nameEl);

	// Close button
	const closeEl = document.createElement("div");
	closeEl.className = "tab-close";
	const closeSvg = createSvg(ns, "svg", {
		class: "close-icon",
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		"stroke-width": "2",
		"stroke-linecap": "round",
	});
	closeSvg.appendChild(
		createSvg(ns, "line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
	);
	closeSvg.appendChild(
		createSvg(ns, "line", { x1: "6", y1: "6", x2: "18", y2: "18" }),
	);
	closeEl.appendChild(closeSvg);
	closeEl.title = "Close tab";
	closeEl.addEventListener("click", (e) => {
		e.stopPropagation();
		ipcRenderer.invoke("close-tab", tab.id);
	});
	tabEl.appendChild(closeEl);

	// Click to switch tab
	tabEl.addEventListener("click", () => {
		ipcRenderer.invoke("switch-tab", tab.id);
	});

	return tabEl;
}
