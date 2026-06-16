// Custom Dialog System - Beautiful, professional grade UI
(function() {
  let confirmCallback = null;

  // Custom Alert
  window.customAlert = function(message, title = 'Notice', type = 'info') {
    const modal = document.getElementById('customAlertModal');
    const iconEl = modal.querySelector('.custom-modal-icon');
    const titleEl = modal.querySelector('.custom-modal-title');
    const messageEl = modal.querySelector('.custom-modal-message');
    
    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    // Set icon based on type
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ',
      question: '?'
    };
    
    iconEl.textContent = icons[type] || icons.info;
    iconEl.className = `custom-modal-icon ${type}`;
    
    // Show modal with animation
    modal.style.display = 'flex';
    setTimeout(() => {
      modal.classList.add('show');
    }, 10);
  };

  // Custom Confirm
  window.customConfirm = function(message, title = 'Confirm Action', type = 'question') {
    return new Promise((resolve) => {
      const modal = document.getElementById('customConfirmModal');
      const iconEl = modal.querySelector('.custom-modal-icon');
      const titleEl = modal.querySelector('.custom-modal-title');
      const messageEl = modal.querySelector('.custom-modal-message');
      
      // Set content
      titleEl.textContent = title;
      messageEl.textContent = message;
      
      // Set icon
      const icons = {
        danger: '⚠',
        warning: '⚠',
        question: '?',
        info: 'ℹ'
      };
      
      iconEl.textContent = icons[type] || icons.question;
      iconEl.className = `custom-modal-icon ${type}`;
      
      // Store callback
      confirmCallback = resolve;
      
      // Show modal with animation
      modal.style.display = 'flex';
      setTimeout(() => {
        modal.classList.add('show');
      }, 10);
    });
  };

  // Handle confirm response
  window.handleConfirmResponse = function(confirmed) {
    const modal = document.getElementById('customConfirmModal');
    modal.classList.remove('show');
    setTimeout(() => {
      modal.style.display = 'none';
      if (confirmCallback) {
        confirmCallback(confirmed);
        confirmCallback = null;
      }
    }, 300);
  };

  // Close custom alert
  window.closeCustomAlert = function() {
    const modal = document.getElementById('customAlertModal');
    modal.classList.remove('show');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
  };

  // Override native alert and confirm
  const originalAlert = window.alert;
  const originalConfirm = window.confirm;

  window.alert = function(message) {
    // Determine type based on message content
    let type = 'info';
    let title = 'Notice';
    
    if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
      type = 'error';
      title = 'Error';
    } else if (message.toLowerCase().includes('success') || message.toLowerCase().includes('completed')) {
      type = 'success';
      title = 'Success';
    } else if (message.toLowerCase().includes('warning') || message.toLowerCase().includes('invalid')) {
      type = 'warning';
      title = 'Warning';
    }
    
    customAlert(message, title, type);
  };

  window.confirm = function(message) {
    // Synchronous callers need the native blocking result. Opening the custom
    // modal here leaves a second unresolved dialog on screen.
    return originalConfirm(message);
  };

  // For async confirm, provide a new method
  window.confirmAsync = function(message, title, type) {
    return customConfirm(message, title, type);
  };
})();
