export const HELPERS = `
    function statusClass(status) {
      if (!status) return '';
      if (status >= 500) return 'status-5xx';
      if (status >= 400) return 'status-4xx';
      return 'status-2xx';
    }

    function formatTime(ts) {
      return new Date(ts).toLocaleTimeString();
    }

    function formatDate(ts) {
      if (!ts) return '—';
      return new Date(ts * 1000).toLocaleString();
    }
`;
