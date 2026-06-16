(function () {
  'use strict';

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function addToCart(variantId) {
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: parseInt(variantId, 10), quantity: 1 }),
    }).then(function (res) {
      return res.json();
    });
  }

  function refreshCartCount() {
    fetch('/cart.js')
      .then(function (res) { return res.json(); })
      .then(function (cart) {
        document.querySelectorAll('.cart-count-bubble').forEach(function (bubble) {
          var visible = bubble.querySelector('[aria-hidden]');
          var sr = bubble.querySelector('.visually-hidden');
          if (visible) visible.textContent = cart.item_count;
          if (sr) sr.textContent = cart.item_count;
          // Show the bubble if previously hidden (empty cart)
          bubble.classList.remove('hidden');
        });
      })
      .catch(function () {});
  }

  /**
   * After adding a upsell item, refresh the cart drawer totals via Shopify's
   * Section Rendering API so the subtotal stays in sync without a full page reload.
   */
  function refreshDrawerTotals() {
    fetch('/?sections=cart-drawer')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data['cart-drawer']) return;
        var parser = new DOMParser();
        var doc = parser.parseFromString(data['cart-drawer'], 'text/html');

        // Update total price text only — avoids disrupting scroll/focus
        var newTotal = doc.querySelector('.totals__total-value');
        var liveTotal = document.querySelector('#CartDrawer .totals__total-value');
        if (newTotal && liveTotal) {
          liveTotal.textContent = newTotal.textContent;
        }

        // Update the live-region text used for screen readers
        var liveRegion = document.getElementById('CartDrawer-LiveRegionText');
        if (liveRegion) {
          var newRegion = doc.getElementById('CartDrawer-LiveRegionText');
          if (newRegion) liveRegion.textContent = newRegion.textContent;
        }
      })
      .catch(function () {});
  }

  /**
   * Hide an upsell item from the strip once its product is in the cart.
   * Called after a successful add-to-cart anywhere in the page.
   */
  function hideStripItem(productId) {
    var selector = '.cart-upsell__item[data-upsell-product-id="' + productId + '"]';
    document.querySelectorAll(selector).forEach(function (el) {
      el.hidden = true;
    });
  }

  /**
   * Read current cart state and hide any strip items whose products are already carted.
   * Runs on cart update events so the strip stays accurate after quantity changes too.
   */
  function syncStripWithCart() {
    fetch('/cart.js')
      .then(function (res) { return res.json(); })
      .then(function (cart) {
        var cartedIds = new Set(cart.items.map(function (item) { return String(item.product_id); }));
        document.querySelectorAll('.cart-upsell__item[data-upsell-product-id]').forEach(function (item) {
          if (cartedIds.has(item.dataset.upsellProductId)) {
            item.hidden = true;
          }
        });
      })
      .catch(function () {});
  }

  // ─── Pre-checkout modal ───────────────────────────────────────────────────

  var _checkoutSource = null; // button that triggered checkout

  function getVisibleStripItems() {
    return Array.from(document.querySelectorAll('.cart-upsell__item:not([hidden])'));
  }

  function openModal(stripItems) {
    var modal = document.getElementById('CartUpsellModal');
    if (!modal) return;

    var container = modal.querySelector('[data-modal-products]');
    container.innerHTML = '';

    stripItems.slice(0, 3).forEach(function (stripItem) {
      var card = buildModalCard(stripItem);
      if (card) container.appendChild(card);
    });

    modal.hidden = false;
    document.body.classList.add('cart-upsell-modal-open');

    var closeBtn = modal.querySelector('[data-modal-close]');
    if (closeBtn) closeBtn.focus();
  }

  function buildModalCard(stripItem) {
    var productId = stripItem.dataset.upsellProductId;
    var addBtn = stripItem.querySelector('[data-upsell-add]');
    var optionsLink = stripItem.querySelector('.cart-upsell__options-link');
    var titleEl = stripItem.querySelector('.cart-upsell__title');
    var priceEl = stripItem.querySelector('.cart-upsell__price');
    var imgEl = stripItem.querySelector('.cart-upsell__img');

    var div = document.createElement('div');
    div.className = 'cart-upsell-modal__product';

    var imgHtml = imgEl
      ? '<img class="cart-upsell-modal__img" src="' + imgEl.src + '" alt="' + (imgEl.alt || '') + '" width="56" height="56" loading="lazy">'
      : '';

    var titleHtml = titleEl
      ? '<p class="cart-upsell-modal__product-title">' + titleEl.textContent.trim() + '</p>'
      : '';

    var priceHtml = priceEl
      ? '<p class="cart-upsell-modal__product-price">' + priceEl.innerHTML + '</p>'
      : '';

    var actionHtml = '';
    if (addBtn) {
      actionHtml = '<button type="button" class="cart-upsell-modal__add button button--secondary"'
        + ' data-modal-upsell-add'
        + ' data-variant-id="' + addBtn.dataset.variantId + '"'
        + ' data-product-id="' + productId + '">'
        + (addBtn.textContent.trim() || '+')
        + '</button>';
    } else if (optionsLink) {
      actionHtml = '<a href="' + optionsLink.href + '" class="cart-upsell-modal__add button button--secondary">'
        + optionsLink.textContent.trim()
        + '</a>';
    }

    div.innerHTML = imgHtml
      + '<div class="cart-upsell-modal__product-info">' + titleHtml + priceHtml + '</div>'
      + actionHtml;

    return div;
  }

  function closeModal() {
    var modal = document.getElementById('CartUpsellModal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('cart-upsell-modal-open');
    if (_checkoutSource) _checkoutSource.focus();
  }

  function proceedToCheckout() {
    if (!_checkoutSource) {
      window.location.href = '/checkout';
      return;
    }
    // Use the button's associated form so Shopify preserves cart token, notes, etc.
    var form = _checkoutSource.form
      || document.getElementById('CartDrawer-Form')
      || document.getElementById('cart');
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit(_checkoutSource);
    } else if (form) {
      form.submit();
    } else {
      window.location.href = '/checkout';
    }
  }

  // ─── Event delegation ─────────────────────────────────────────────────────

  document.addEventListener('click', function (e) {

    // 1. Upsell strip "Add" button
    var addBtn = e.target.closest('[data-upsell-add]');
    if (addBtn) {
      e.preventDefault();
      if (addBtn.disabled) return;

      var variantId = addBtn.dataset.variantId;
      var productId = addBtn.dataset.productId;
      var originalLabel = addBtn.textContent.trim();

      addBtn.disabled = true;
      addBtn.textContent = '…'; // ellipsis

      addToCart(variantId)
        .then(function (data) {
          if (data.status) throw new Error(data.description || 'Cart error');
          hideStripItem(productId);
          refreshCartCount();
          refreshDrawerTotals();
        })
        .catch(function () {
          addBtn.disabled = false;
          addBtn.textContent = originalLabel;
        });
      return;
    }

    // 2. Checkout button intercept (only when modal is present & items are available)
    var checkoutBtn = e.target.closest('#CartDrawer-Checkout, #checkout');
    if (checkoutBtn) {
      var modal = document.getElementById('CartUpsellModal');
      if (!modal) return; // modal not in DOM — let checkout proceed normally

      var visible = getVisibleStripItems();
      if (visible.length === 0) return; // nothing to upsell — let checkout proceed

      e.preventDefault();
      e.stopImmediatePropagation();
      _checkoutSource = checkoutBtn;
      openModal(visible);
      return;
    }

    // 3. Modal overlay click → close
    if (e.target.closest('[data-modal-overlay]')) {
      closeModal();
      return;
    }

    // 4. Modal close button
    if (e.target.closest('[data-modal-close]')) {
      closeModal();
      return;
    }

    // 5. Modal "skip" → close + proceed to checkout
    if (e.target.closest('[data-modal-skip]')) {
      closeModal();
      proceedToCheckout();
      return;
    }

    // 6. Modal checkout button → proceed (close first)
    if (e.target.closest('[data-modal-checkout]')) {
      closeModal();
      proceedToCheckout();
      return;
    }

    // 7. Modal product "Add" button
    var modalAdd = e.target.closest('[data-modal-upsell-add]');
    if (modalAdd) {
      e.preventDefault();
      if (modalAdd.disabled) return;

      var mVariantId = modalAdd.dataset.variantId;
      var mProductId = modalAdd.dataset.productId;
      var mOriginal = modalAdd.textContent.trim();

      modalAdd.disabled = true;
      modalAdd.textContent = '…';

      addToCart(mVariantId)
        .then(function (data) {
          if (data.status) throw new Error(data.description || 'Cart error');

          // Remove card from modal
          var card = modalAdd.closest('.cart-upsell-modal__product');
          if (card) card.remove();

          // Mirror removal in strip
          hideStripItem(mProductId);
          refreshCartCount();
          refreshDrawerTotals();

          // If modal is now empty, close and go to checkout
          var modal = document.getElementById('CartUpsellModal');
          if (modal && modal.querySelector('[data-modal-products]').children.length === 0) {
            closeModal();
            proceedToCheckout();
          }
        })
        .catch(function () {
          modalAdd.disabled = false;
          modalAdd.textContent = mOriginal;
        });
      return;
    }

  }, true); // capture phase so we fire before any form submit handlers

  // Escape key closes modal
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var modal = document.getElementById('CartUpsellModal');
    if (modal && !modal.hidden) closeModal();
  });

  // ─── Cart update sync ─────────────────────────────────────────────────────

  /**
   * Dawn's pubsub.js exports subscribe/publish as module-level functions.
   * We hook into the same cart state via a MutationObserver on the cart count
   * bubble, which Dawn updates after every cart change. This lets us keep the
   * upsell strip in sync without importing from pubsub.js.
   */
  var cartCountBubble = document.querySelector('.cart-count-bubble');
  if (cartCountBubble) {
    var observer = new MutationObserver(function () {
      syncStripWithCart();
    });
    observer.observe(cartCountBubble, { childList: true, subtree: true, characterData: true });
  }

  // Initial sync in case the page loaded with a non-empty cart and the
  // server-side Liquid didn't have the latest state (edge case on cached pages)
  syncStripWithCart();

})();
