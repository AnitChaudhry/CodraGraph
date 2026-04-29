import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';

/**
 * Light/dark theme toggle button. Icon flips, tooltip describes the
 * action. Persists via the useTheme hook.
 */
export const ThemeToggle = (): React.JSX.Element => {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="h-8 w-8"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
};
