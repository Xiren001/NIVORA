(function () {
  'use strict';

  var CARET_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>';

  // ─── Cart helpers ─────────────────────────────────────────────────────────

  function addToCart(variantId) {
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: parseInt(variantId, 10), quantity: 1 }),
    }).then(function (r) { return r.json(); });
  }

  function refreshCartCount() {
    fetch('/cart.js')
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        document.querySelectorAll('.cart-count-bubble').forEach(function (el) {
          var vis = el.querySelector('[aria-hidden]');
          var sr  = el.querySelector('.visually-hidden');
          if (vis) vis.textContent = cart.item_count;
          if (sr)  sr.textContent  = cart.item_count;
          el.classList.remove('hidden');
        });
      })
      .catch(function () {});
  }

  function refreshDrawerTotals() {
    fetch('/?sections=cart-drawer')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data['cart-drawer']) return;
        var doc = new DOMParser().parseFromString(data['cart-drawer'], 'text/html');
        var newTotal = doc.querySelector('.totals__total-value');
        var liveTotal = document.querySelector('#CartDrawer .totals__total-value');
        if (newTotal && liveTotal) liveTotal.textContent = newTotal.textContent;
      })
      .catch(function () {});
  }

  function hideStripItem(productId) {
    document.querySelectorAll('.cart-upsell__item[data-upsell-product-id="' + productId + '"]')
      .forEach(function (el) { el.hidden = true; });

    // Rebuild the nav after hiding an item
    document.querySelectorAll('.cart-upsell--drawer[data-cart-upsell]')
      .forEach(function (strip) { refreshNav(strip); });
  }

  function syncStripWithCart() {
    fetch('/cart.js')
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var ids = new Set(cart.items.map(function (i) { return String(i.product_id); }));
        document.querySelectorAll('.cart-upsell__item[data-upsell-product-id]').forEach(function (el) {
          if (ids.has(el.dataset.upsellProductId)) el.hidden = true;
        });
        document.querySelectorAll('.cart-upsell--drawer[data-cart-upsell]')
          .forEach(function (strip) { refreshNav(strip); });
      })
      .catch(function () {});
  }

  // ─── 1-up carousel nav ────────────────────────────────────────────────────

  function initAllNavs() {
    document.querySelectorAll('.cart-upsell--drawer[data-cart-upsell]')
      .forEach(function (strip) { refreshNav(strip); });
  }

  function refreshNav(strip) {
    var list = strip.querySelector('.cart-upsell__list');
    if (!list) return;

    var oldNav = strip.querySelector('.cart-upsell__nav');
    if (oldNav) oldNav.remove();
    if (list._upsellScroll) list.removeEventListener('scroll', list._upsellScroll, { passive: true });

    var items = Array.from(list.querySelectorAll('.cart-upsell__item:not([hidden])'));

    // Always reset to the first visible item so we never land on an empty slot
    list.scrollLeft = 0;

    if (items.length <= 1) return;

    var nav = document.createElement('div');
    nav.className = 'cart-upsell__nav';
    nav.innerHTML =
      '<button type="button" class="cart-upsell__nav-btn cart-upsell__nav-btn--prev" data-nav-prev aria-label="Previous" disabled>' + CARET_SVG + '</button>' +
      '<div class="cart-upsell__dots">' +
        items.map(function (_, i) {
          return '<button type="button" class="cart-upsell__dot' + (i === 0 ? ' is-active' : '') +
            '" data-dot-index="' + i + '" aria-label="Product ' + (i + 1) + '"></button>';
        }).join('') +
      '</div>' +
      '<button type="button" class="cart-upsell__nav-btn cart-upsell__nav-btn--next" data-nav-next aria-label="Next">' + CARET_SVG + '</button>';

    strip.appendChild(nav);

    function idx() { return Math.round(list.scrollLeft / (list.clientWidth || 1)); }

    function goTo(n) {
      list.scrollTo({ left: list.clientWidth * Math.max(0, Math.min(items.length - 1, n)), behavior: 'smooth' });
    }

    function update() {
      var i = idx();
      nav.querySelectorAll('.cart-upsell__dot').forEach(function (d, j) { d.classList.toggle('is-active', j === i); });
      nav.querySelector('[data-nav-prev]').disabled = i === 0;
      nav.querySelector('[data-nav-next]').disabled = i === items.length - 1;
    }

    list._upsellScroll = update;
    list.addEventListener('scroll', update, { passive: true });

    nav.querySelector('[data-nav-prev]').addEventListener('click', function () { goTo(idx() - 1); });
    nav.querySelector('[data-nav-next]').addEventListener('click', function () { goTo(idx() + 1); });
    nav.querySelectorAll('[data-dot-index]').forEach(function (d) {
      d.addEventListener('click', function () { goTo(parseInt(d.dataset.dotIndex, 10)); });
    });
  }

  // ─── Pre-checkout modal ───────────────────────────────────────────────────

  var _checkoutSource = null;

  function getVisibleItems() {
    return Array.from(document.querySelectorAll('.cart-upsell__item:not([hidden])'));
  }

  function openModal(items) {
    var modal = document.getElementById('CartUpsellModal');
    if (!modal) return;

    var container = modal.querySelector('[data-modal-products]');
    container.innerHTML = '';
    items.slice(0, 3).forEach(function (item) {
      var card = buildModalCard(item);
      if (card) container.appendChild(card);
    });

    modal.hidden = false;
    document.body.classList.add('cart-upsell-modal-open');
    var btn = modal.querySelector('[data-modal-close]');
    if (btn) btn.focus();
  }

  function buildModalCard(item) {
    var productId   = item.dataset.upsellProductId;
    var addBtn      = item.querySelector('[data-upsell-add]');
    var optionsLink = item.querySelector('.cart-upsell__options-link');
    var titleEl     = item.querySelector('.cart-upsell__title');
    var priceEl     = item.querySelector('.cart-upsell__price');
    var imgEl       = item.querySelector('.cart-upsell__img');

    var div = document.createElement('div');
    div.className = 'cart-upsell-modal__product';

    var imgHtml = imgEl
      ? '<img class="cart-upsell-modal__img" src="' + imgEl.src + '" alt="' + (imgEl.alt || '') + '" width="56" height="56" loading="lazy">'
      : '';
    var titleHtml = titleEl ? '<p class="cart-upsell-modal__product-title">' + titleEl.textContent.trim() + '</p>' : '';
    var priceHtml = priceEl ? '<p class="cart-upsell-modal__product-price">' + priceEl.innerHTML + '</p>'          : '';

    var actionHtml = '';
    if (addBtn) {
      actionHtml = '<button type="button" class="cart-upsell-modal__add button button--secondary"'
        + ' data-modal-upsell-add data-variant-id="' + addBtn.dataset.variantId + '" data-product-id="' + productId + '">'
        + (addBtn.textContent.trim() || '+') + '</button>';
    } else if (optionsLink) {
      actionHtml = '<a href="' + optionsLink.href + '" class="cart-upsell-modal__add button button--secondary">'
        + optionsLink.textContent.trim() + '</a>';
    }

    div.innerHTML = imgHtml + '<div class="cart-upsell-modal__product-info">' + titleHtml + priceHtml + '</div>' + actionHtml;
    return div;
  }

  function closeModal() {
    var modal = document.getElementById('CartUpsellModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('cart-upsell-modal-open');
  }

  function proceedToCheckout() {
    // Restore checkout button state before submitting (clears any stuck loading/disabled classes)
    if (_checkoutSource) {
      _checkoutSource.disabled  = false;
      _checkoutSource.classList.remove('loading', 'is-loading');
    }

    if (!_checkoutSource) { window.location.href = '/checkout'; return; }

    var form = _checkoutSource.form
      || document.getElementById('CartDrawer-Form')
      || document.getElementById('cart');

    if (form) {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit(_checkoutSource);
      } else {
        form.submit();
      }
    } else {
      window.location.href = '/checkout';
    }
  }

  // ─── Event delegation ─────────────────────────────────────────────────────

  document.addEventListener('click', function (e) {

    // Upsell strip "Add" button
    var addBtn = e.target.closest('[data-upsell-add]');
    if (addBtn) {
      e.preventDefault();
      if (addBtn.disabled) return;
      var variantId  = addBtn.dataset.variantId;
      var productId  = addBtn.dataset.productId;
      var origLabel  = addBtn.textContent.trim();
      addBtn.disabled = true;
      addBtn.textContent = '…';
      addToCart(variantId)
        .then(function (data) {
          if (data.status) throw new Error(data.description || 'Cart error');
          hideStripItem(productId);
          refreshCartCount();
          refreshDrawerTotals();
        })
        .catch(function () {
          addBtn.disabled = false;
          addBtn.textContent = origLabel;
        });
      return;
    }

    // Checkout button intercept
    var checkoutBtn = e.target.closest('#CartDrawer-Checkout, #checkout');
    if (checkoutBtn) {
      var modal = document.getElementById('CartUpsellModal');
      if (!modal) return;
      var visible = getVisibleItems();
      if (visible.length === 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      _checkoutSource = checkoutBtn;
      openModal(visible);
      return;
    }

    // Modal overlay click → close WITHOUT proceeding (user changed their mind)
    if (e.target.closest('[data-modal-overlay]')) {
      closeModal();
      return;
    }

    // Modal X (close button) → close AND proceed to checkout
    if (e.target.closest('[data-modal-close]')) {
      closeModal();
      proceedToCheckout();
      return;
    }

    // Modal "No thanks" skip → close AND proceed to checkout
    if (e.target.closest('[data-modal-skip]')) {
      closeModal();
      proceedToCheckout();
      return;
    }

    // Modal checkout button
    if (e.target.closest('[data-modal-checkout]')) {
      closeModal();
      proceedToCheckout();
      return;
    }

    // Modal product "Add" button
    var modalAdd = e.target.closest('[data-modal-upsell-add]');
    if (modalAdd) {
      e.preventDefault();
      if (modalAdd.disabled) return;
      var mVariantId = modalAdd.dataset.variantId;
      var mProductId = modalAdd.dataset.productId;
      var mOrig      = modalAdd.textContent.trim();
      modalAdd.disabled = true;
      modalAdd.textContent = '…';
      addToCart(mVariantId)
        .then(function (data) {
          if (data.status) throw new Error(data.description || 'Cart error');
          var card = modalAdd.closest('.cart-upsell-modal__product');
          if (card) card.remove();
          hideStripItem(mProductId);
          refreshCartCount();
          refreshDrawerTotals();
          var modal = document.getElementById('CartUpsellModal');
          if (modal && modal.querySelector('[data-modal-products]').children.length === 0) {
            closeModal();
            proceedToCheckout();
          }
        })
        .catch(function () {
          modalAdd.disabled = false;
          modalAdd.textContent = mOrig;
        });
      return;
    }

  }, true); // capture phase — fires before form submit

  // Escape key: close modal but DON'T proceed (same as overlay click)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var modal = document.getElementById('CartUpsellModal');
    if (modal && !modal.hidden) closeModal();
  });

  // ─── Cart count sync ──────────────────────────────────────────────────────

  // Watch for Dawn's cart count changes and keep upsell strip in sync
  var bubble = document.querySelector('.cart-count-bubble');
  if (bubble) {
    new MutationObserver(function () { syncStripWithCart(); })
      .observe(bubble, { childList: true, subtree: true, characterData: true });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  syncStripWithCart();
  initAllNavs();

  // Re-init navs each time the cart drawer opens so clientWidth is live
  var drawerEl = document.querySelector('cart-drawer');
  if (drawerEl) {
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type === 'attributes' && drawerEl.classList.contains('is-open')) {
          initAllNavs();
        }
      });
    }).observe(drawerEl, { attributes: true, attributeFilter: ['class'] });
  }

  // When cart goes from empty → non-empty, Dawn re-renders the entire drawer
  // and freshly injects the upsell strip. Watch for it appearing in the DOM.
  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var nodes = mutations[i].addedNodes;
      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        if (node.nodeType !== 1) continue;
        // Check if the added node IS the strip or CONTAINS it
        if (node.matches('[data-cart-upsell]') || node.querySelector('[data-cart-upsell]')) {
          syncStripWithCart(); // hides carted items then calls refreshNav for every strip
          return;
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
