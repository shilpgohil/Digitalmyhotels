/**
 * Allow TypeScript to accept side-effect CSS imports from node_modules
 * (e.g. `import "driver.js/dist/driver.css"`).
 */
declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
