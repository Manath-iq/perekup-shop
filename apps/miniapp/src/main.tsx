import { render } from 'preact';
import { App } from './App';
import { initTelegram, inTelegram, tg } from './tg';
import './styles.css';

initTelegram();

// тема Telegram → CSS-переменные; вне Telegram работают фолбэки из styles.css
const root = document.documentElement;
const applyScheme = () => {
  const dark = inTelegram ? tg!.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.scheme = dark ? 'dark' : 'light';
  root.classList.toggle('in-tg', inTelegram);
};
applyScheme();
if (inTelegram) tg!.onEvent('themeChanged', applyScheme);
else matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyScheme);

render(<App />, document.getElementById('app')!);
