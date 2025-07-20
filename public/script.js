window.addEventListener('DOMContentLoaded', () => {
    const loadScript = (src) => {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    };

    Promise.all([
        loadScript('js/ui.js'),
        loadScript('js/websocket.js'),
        loadScript('js/app.js')
    ]).then(() => {
        window.app = new JiraConverter();
    }).catch(error => {
        console.error('Failed to load application modules:', error);
        alert('Failed to load application. Please refresh the page.');
    });
}); 