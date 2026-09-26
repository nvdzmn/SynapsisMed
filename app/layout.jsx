import "./globals.css";

export const metadata = {
  title: "SynapseMed | TrialLens",
  description: "Evidence-to-cohort clinical surveillance workspace"
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
