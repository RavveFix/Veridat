import { render } from 'preact';
import { AdminPortal } from './AdminPortal';
import '../styles/main.css';
import '../styles/components/admin-portal.css';

const root = document.getElementById('app');

if (root) {
    render(<AdminPortal />, root);
} else {
    console.error('Admin root element not found');
}
