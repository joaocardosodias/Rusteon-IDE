import { useEffect } from "react";
import { IDELayout } from "./components/IDELayout";

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return <IDELayout />;
}

export default App;
