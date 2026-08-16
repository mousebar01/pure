import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: ["apps/web/.next/**", "out/**"],
  },
  ...coreWebVitals,
  ...typescript,
  {
    settings: {
      next: { rootDir: "apps/web" },
    },
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
