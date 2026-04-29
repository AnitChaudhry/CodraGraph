import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Reset storage between tests
beforeEach(() => {
  sessionStorage.removeItem('codragraph-llm-settings');
  localStorage.removeItem('codragraph-llm-settings'); // legacy key (migration)
});
