(function forumApp() {
  function debounce(fn, delay) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function formatDate(dateValue) {
    try {
      return new Date(dateValue).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    } catch (error) {
      return dateValue;
    }
  }

  function initSearchLiveMode() {
    const input = document.getElementById('searchInput');
    const container = document.getElementById('liveSearchContainer');
    const meta = document.getElementById('liveSearchMeta');
    const list = document.getElementById('liveSearchResults');
    const template = document.getElementById('searchResultTemplate');

    if (!input || !container || !meta || !list || !template) {
      return;
    }

    let pendingController = null;

    function renderEmpty(message) {
      list.innerHTML = `<div class="card border-0 shadow-sm"><div class="card-body py-5 text-center"><p class="mb-0">${message}</p></div></div>`;
    }

    function renderResults(payload) {
      list.innerHTML = '';

      if (!payload.results.length) {
        renderEmpty(payload.query ? `No results found for "${payload.query}".` : 'Type to search instantly.');
        meta.querySelector('strong').textContent = payload.query ? '0 results' : 'Type to search instantly';
        return;
      }

      const fragment = document.createDocumentFragment();

      payload.results.forEach((item, index) => {
        const node = template.content.cloneNode(true);
        const wrapper = node.querySelector('.search-result-item');
        const kind = node.querySelector('[data-role="kind"]');
        const title = node.querySelector('[data-role="title"]');
        const metaText = node.querySelector('[data-role="meta"]');
        const excerpt = node.querySelector('[data-role="excerpt"]');
        const category = node.querySelector('[data-role="category"]');

        kind.textContent = item.kind;
        title.textContent = item.title;
        title.href = item.url;
        metaText.textContent = `@${item.author} · ${formatDate(item.created_at)}`;
        excerpt.textContent = item.excerpt;
        category.textContent = `Category: ${item.category}`;

        wrapper.style.animationDelay = `${index * 30}ms`;
        wrapper.classList.add('fade-in-item');
        fragment.appendChild(node);
      });

      list.appendChild(fragment);
      meta.querySelector('strong').textContent = `${payload.total} results`;
    }

    const runSearch = debounce(async (query) => {
      if (pendingController) {
        pendingController.abort();
      }

      pendingController = new AbortController();

      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: pendingController.signal
        });

        if (!response.ok) {
          return;
        }

        const payload = await response.json();
        renderResults(payload);
      } catch (error) {
        if (error.name !== 'AbortError') {
          renderEmpty('Search temporarily unavailable.');
        }
      }
    }, 180);

    input.addEventListener('input', (event) => {
      runSearch(event.target.value.trim());
    });

    if (!container.dataset.query) {
      runSearch('');
    }
  }

  function initSectionOrdering() {
    const list = document.getElementById('sectionOrderList');
    const input = document.getElementById('sectionOrderInput');

    if (!list || !input || !window.Sortable) {
      return;
    }

    const updateInput = () => {
      const order = [...list.querySelectorAll('[data-section]')].map((node) => node.getAttribute('data-section'));
      input.value = order.join(',');
    };

    window.Sortable.create(list, {
      animation: 130,
      onSort: updateInput
    });

    updateInput();
  }

  function initThreadMediaToggle() {
    const typeSelect = document.getElementById('threadMediaType');
    const urlInput = document.getElementById('threadMediaUrl');

    if (!typeSelect || !urlInput) {
      return;
    }

    const sync = () => {
      const isText = typeSelect.value === 'text';
      urlInput.disabled = isText;
      if (isText) {
        urlInput.value = '';
        urlInput.placeholder = 'Disabled for text-only threads';
      } else {
        urlInput.placeholder = 'https://...';
      }
    };

    typeSelect.addEventListener('change', sync);
    sync();
  }

  initSearchLiveMode();
  initSectionOrdering();
  initThreadMediaToggle();
})();
