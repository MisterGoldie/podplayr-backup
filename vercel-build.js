const fs = require('fs');
const path = require('path');

// Read the package.json file
const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Function to remove platform-specific dependencies
function removePlatformSpecificDeps(dependencies) {
  if (!dependencies) return dependencies;
  
  const newDeps = { ...dependencies };
  
  // Remove any @next/swc-* packages that are platform-specific
  Object.keys(newDeps).forEach(dep => {
    if (dep.startsWith('@next/swc-')) {
      console.log(`Removing platform-specific dependency: ${dep}`);
      delete newDeps[dep];
    }
  });
  
  return newDeps;
}

// Clean dependencies and devDependencies
packageJson.dependencies = removePlatformSpecificDeps(packageJson.dependencies);
packageJson.devDependencies = removePlatformSpecificDeps(packageJson.devDependencies);

// Write the updated package.json
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

console.log('Successfully removed platform-specific dependencies for Vercel deployment');
