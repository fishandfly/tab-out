import { createRoot } from 'react-dom/client';
import './style.css';

const root = createRoot(document.getElementById('root'));

async function bootstrap() {
  const { default: NotesApp } = await import('./app.jsx');
  root.render(<NotesApp />);
}

bootstrap();
