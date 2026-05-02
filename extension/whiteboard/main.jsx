import { createRoot } from 'react-dom/client';
import './style.css';

window.EXCALIDRAW_ASSET_PATH = new URL('./assets/', window.location.href).toString();

const root = createRoot(document.getElementById('root'));

async function bootstrap() {
  const { default: WhiteboardApp } = await import('./app.jsx');
  root.render(<WhiteboardApp />);
}

bootstrap();
