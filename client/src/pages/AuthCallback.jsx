import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

// Landing page after Google OAuth: the server already set the refresh cookie, so just resume.
export default function AuthCallback() {
  const { resume } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    resume().then(() => navigate('/', { replace: true }), () => navigate('/login?error=oauth', { replace: true }));
  }, [resume, navigate]);

  return <div className="center muted">Signing you in…</div>;
}
