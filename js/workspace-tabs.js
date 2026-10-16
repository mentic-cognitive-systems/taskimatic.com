const workspaceTabs = [...document.querySelectorAll('.workspace-tab')];
function selectWorkspaceTab(selectedTab) {
    for (const tab of workspaceTabs) {
        const selected = tab === selectedTab;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    }
}
for (const tab of workspaceTabs) {
    tab.addEventListener('click', () => selectWorkspaceTab(tab));
    tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = workspaceTabs.indexOf(tab);
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? workspaceTabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + workspaceTabs.length) % workspaceTabs.length;
        selectWorkspaceTab(workspaceTabs[nextIndex]);
        workspaceTabs[nextIndex].focus();
    });
}
