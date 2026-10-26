import { render } from 'preact';
import { App } from './App';
import { initTelegram, inTelegram, tg } from './tg';
import { syncChrome } from './theme';
import './styles.css';

initTelegram();

// светлая или тёмная — как в Telegram; вне Telegram — как в системе
const root = document.documentElement;
const applyScheme = () => {
  const dark = inTelegram ? tg!.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.scheme = dark ? 'dark' : 'light';
  syncChrome();
};
applyScheme();
if (inTelegram) tg!.onEvent('themeChanged', applyScheme);
else matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyScheme);

render(<App />, document.getElementById('app')!);
