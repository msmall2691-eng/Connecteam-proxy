(function() {
  'use strict';

  // Determine the base URL from the script's src attribute
  var scripts = document.getElementsByTagName('script');
  var currentScript = scripts[scripts.length - 1];
  var scriptSrc = currentScript.src || '';
  var baseUrl = scriptSrc.replace(/\/embed\.js.*$/, '');

  function createEmbed() {
    var container = document.getElementById('maine-clean-form');
    if (!container) return;

    var iframe = document.createElement('iframe');
    iframe.src = baseUrl + '/embed-form.html';
    iframe.style.width = '100%';
    iframe.style.minHeight = '820px';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '16px';
    iframe.style.overflow = 'hidden';
    iframe.style.colorScheme = 'dark';
    iframe.title = 'Request a Quote - Maine Cleaning Co';
    iframe.setAttribute('loading', 'lazy');

    // Listen for resize messages from the iframe
    window.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'maine-clean-resize' && e.data.height) {
        iframe.style.height = e.data.height + 'px';
      }
    });

    container.innerHTML = '';
    container.appendChild(iframe);
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createEmbed);
  } else {
    createEmbed();
  }
})();
