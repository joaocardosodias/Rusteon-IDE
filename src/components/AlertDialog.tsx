import { useIDEStore } from '../store/useIDEStore';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import CloseIcon from '@mui/icons-material/Close';

export function AlertDialog() {
  const { alertConfig, closeAlert } = useIDEStore();

  if (!alertConfig.open) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.65)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'dialogFadeIn 150ms ease-out'
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeAlert(); }}
    >
      <div 
        style={{
          width: '500px',
          backgroundColor: '#141517',
          border: '1px solid #2a2c2f',
          borderRadius: '8px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'scaleUp 0.15s ease-out'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid #2a2c2f',
          backgroundColor: '#1c1e21',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ErrorOutlinedIcon sx={{ fontSize: 18, color: '#ff9e00' }} />
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#d4d4d4', letterSpacing: '0.2px' }}>
              {alertConfig.title}
            </span>
          </div>
          <button
            onClick={closeAlert}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#666', display: 'flex', alignItems: 'center', padding: '2px',
              borderRadius: '4px', transition: 'color 120ms ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#aaa')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </button>
        </div>

        {/* Message Body */}
        <div style={{
          padding: '24px 24px',
          backgroundColor: '#141517',
          minHeight: '80px',
        }}>
          <p style={{
            margin: 0,
            fontSize: '13px',
            lineHeight: '1.6',
            color: '#a0a2a5',
            whiteSpace: 'pre-line'
          }}>
            {alertConfig.message}
          </p>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px',
          borderTop: '1px solid #2a2c2f',
          backgroundColor: '#1c1e21',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={closeAlert}
            style={{
              padding: '6px 22px', 
              borderRadius: '5px', 
              fontSize: '12.5px',
              fontWeight: 700, 
              cursor: 'pointer',
              border: 'none',
              backgroundColor: 'var(--ide-orange)',
              color: '#fff',
              transition: 'background 120ms ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--ide-orange-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--ide-orange)'}
          >
            OK
          </button>
        </div>
      </div>

      <style>{`
        @keyframes scaleUp {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
