import './globals.css';

export const metadata = {
  title: 'Verbouw planner',
  description: 'Interactieve verbouw- en klusplanner'
};

export default function RootLayout({ children }) {
  return (
    <html lang="nl">
      <body 
        style={{ 
          margin: 0, 
          padding: 0, 
          height: '100dvh', /* Bepaalt exact de schermhoogte */
          width: '100vw',
          background: '#0B1B2B',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {children}
      </body>
    </html>
  );
}