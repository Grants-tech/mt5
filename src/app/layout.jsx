import "./globals.css";

export const metadata = {
  title: "MT5 Simulator",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, backgroundColor: "#000" }}>
        {children}
      </body>
    </html>
  );
}