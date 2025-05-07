const fs = require('fs');
const path = require('path');
const { simpleGit } = require('simple-git');
const glob = require('glob');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { Octokit } = require('@octokit/rest');
const OpenAI = require('openai');

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize GitHub API client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Initialize git
const git = simpleGit();

// Get environment variables
const repoOwner = process.env.REPO_OWNER;
const repoName = process.env.REPO_NAME;
const prNumber = parseInt(process.env.PR_NUMBER, 10);
const commitSha = process.env.COMMIT_SHA;

// Summary statistics for PR comment
let stats = {
  totalFiles: 0,
  totalFunctions: 0,
  totalSuggestions: 0,
  suggestedFiles: []
};

/**
 * Detect functions in a JavaScript/TypeScript file using AST parsing
 * @param {string} filePath - Path to the JavaScript/TypeScript file
 * @returns {Array} Array of detected functions with their metadata
 */
async function detectFunctions(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const fileExtension = path.extname(filePath);
    
    // Configure parser options based on file type
    const parserOptions = {
      sourceType: 'module',
      plugins: [
        'jsx',
        'typescript',
        'classProperties',
        'decorators-legacy',
        'exportDefaultFrom',
      ]
    };
    
    // Add specific plugins for TypeScript files
    if (['.ts', '.tsx'].includes(fileExtension)) {
      if (!parserOptions.plugins.includes('typescript')) {
        parserOptions.plugins.push('typescript');
      }
    }
    
    // Parse the file content into an AST
    const ast = parser.parse(fileContent, parserOptions);
    
    const functions = [];
    
    // Traverse the AST to find functions
    traverse(ast, {
      // Function declarations (function name() {})
      FunctionDeclaration(path) {
        const node = path.node;
        if (node.id && node.id.name) {
          // Check if function already has JSDoc
          const hasJSDoc = path.parent && path.parent.leadingComments && 
                          path.parent.leadingComments.some(comment => 
                            comment.type === 'CommentBlock' && comment.value.startsWith('*'));
          
          if (!hasJSDoc) {
            functions.push({
              name: node.id.name,
              startIndex: node.start,
              content: fileContent.substring(node.start, node.end),
              type: 'function',
              startLine: node.loc.start.line,
              lineContent: fileContent.split('\n')[node.loc.start.line - 1] || ''
            });
          }
        }
      },
      
      // Function expressions (const name = function() {})
      VariableDeclarator(path) {
        const node = path.node;
        if (node.id && node.id.name && 
            node.init && 
            (node.init.type === 'FunctionExpression' || 
             node.init.type === 'ArrowFunctionExpression')) {
          
          // Check if function already has JSDoc
          const hasJSDoc = path.parent && path.parent.parent && path.parent.parent.leadingComments && 
                          path.parent.parent.leadingComments.some(comment => 
                            comment.type === 'CommentBlock' && comment.value.startsWith('*'));
          
          if (!hasJSDoc) {
            functions.push({
              name: node.id.name,
              startIndex: node.start,
              content: fileContent.substring(node.start, node.end),
              type: 'function',
              startLine: node.loc.start.line,
              lineContent: fileContent.split('\n')[node.loc.start.line - 1] || ''
            });
          }
        }
      },
      
      // Class methods
      ClassMethod(path) {
        const node = path.node;
        if (node.key && node.key.name) {
          // Check if method already has JSDoc
          const hasJSDoc = node.leadingComments && 
                          node.leadingComments.some(comment => 
                            comment.type === 'CommentBlock' && comment.value.startsWith('*'));
          
          if (!hasJSDoc) {
            functions.push({
              name: node.key.name,
              startIndex: node.start,
              content: fileContent.substring(node.start, node.end),
              type: 'method',
              startLine: node.loc.start.line,
              lineContent: fileContent.split('\n')[node.loc.start.line - 1] || ''
            });
          }
        }
      },
      
      // Object methods
      ObjectMethod(path) {
        const node = path.node;
        if (node.key && (node.key.name || (node.key.type === 'StringLiteral' && node.key.value))) {
          // Check if method already has JSDoc
          const hasJSDoc = node.leadingComments && 
                          node.leadingComments.some(comment => 
                            comment.type === 'CommentBlock' && comment.value.startsWith('*'));
          
          if (!hasJSDoc) {
            functions.push({
              name: node.key.name || node.key.value,
              startIndex: node.start,
              content: fileContent.substring(node.start, node.end),
              type: 'method',
              startLine: node.loc.start.line,
              lineContent: fileContent.split('\n')[node.loc.start.line - 1] || ''
            });
          }
        }
      }
    });
    
    return functions;
    
  } catch (error) {
    console.error(`Error detecting functions in ${filePath}: ${error.message}`);
    // Fallback to an empty array if parsing fails
    return [];
  }
}

/**
 * Generate a JSDoc comment for a function using OpenAI
 * @param {string} functionName - The name of the function
 * @param {string} functionContent - The content of the function
 * @param {string} filePath - The path to the file containing the function
 * @returns {Promise<string>} The generated JSDoc comment
 */
async function generateJSDocComment(functionName, functionContent, filePath) {
  try {
    const prompt = `
    Generate a concise, accurate JSDoc comment for the following ${path.extname(filePath).replace('.', '')} function:
    
    Function name: ${functionName}
    
    Function code:
    \`\`\`
    ${functionContent}
    \`\`\`
    
    Return ONLY the JSDoc comment without any explanation or additional text. Follow JSDoc standards with proper @param, @returns, @throws tags as appropriate.
    `;
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant that generates accurate JSDoc comments for JavaScript/TypeScript code." },
        { role: "user", content: prompt }
      ],
      max_tokens: 500,
      temperature: 0.2,
    });
    
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error(`Error generating JSDoc for function ${functionName}:`, error);
    return null;
  }
}

/**
 * Get the line number positions in the diff
 * @param {string} filePath - The path to the file
 * @returns {Promise<Object>} An object mapping line numbers to positions in the diff
 */
async function getDiffPositions(filePath) {
  try {
    // Get the diff for the file
    const response = await octokit.pulls.get({
      owner: repoOwner,
      repo: repoName,
      pull_number: prNumber,
      mediaType: {
        format: 'diff'
      }
    });
    
    const diff = response.data;
    const filePattern = new RegExp(`^diff --git a/${filePath.replace(/\//g, '\\/')} b/${filePath.replace(/\//g, '\\/')}`, 'm');
    const fileMatch = diff.match(filePattern);
    
    if (!fileMatch) {
      console.log(`No diff found for file: ${filePath}`);
      return {};
    }
    
    const fileStartIndex = fileMatch.index;
    const nextFileDiff = diff.substring(fileStartIndex + 1).match(/^diff --git/m);
    const fileEndIndex = nextFileDiff ? fileStartIndex + 1 + nextFileDiff.index : diff.length;
    const fileDiff = diff.substring(fileStartIndex, fileEndIndex);
    
    // Parse the diff to get line numbers and positions
    const lines = fileDiff.split('\n');
    let lineMap = {};
    let currentPosition = 0;
    let leftLine = 0;
    let rightLine = 0;
    
    for (const line of lines) {
      if (line.startsWith('@@')) {
        // Parse the hunk header
        const match = line.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@/);
        if (match) {
          leftLine = parseInt(match[1], 10) - 1;
          rightLine = parseInt(match[2], 10) - 1;
        }
      } else if (line.startsWith('-')) {
        leftLine++;
      } else if (line.startsWith('+')) {
        rightLine++;
        lineMap[rightLine] = currentPosition;
      } else if (!line.startsWith('diff') && !line.startsWith('index') && !line.startsWith('---') && !line.startsWith('+++')) {
        leftLine++;
        rightLine++;
        lineMap[rightLine] = currentPosition;
      }
      
      currentPosition++;
    }
    
    return lineMap;
  } catch (error) {
    console.error(`Error getting diff positions for ${filePath}:`, error);
    return {};
  }
}

/**
 * Submit a PR review with suggestions
 * @param {Array} suggestions - Array of suggestion objects
 */
async function submitPRReview(suggestions) {
  if (!suggestions || suggestions.length === 0) {
    console.log('No suggestions to submit');
    return;
  }
  
  try {
    const comments = suggestions.map(suggestion => ({
      path: suggestion.filePath,
      position: suggestion.position,
      body: `${suggestion.jsdocComment}\n\n\`\`\`suggestion\n${suggestion.jsdocComment}\n${suggestion.lineContent}\n\`\`\``
    }));
    
    await octokit.pulls.createReview({
      owner: repoOwner,
      repo: repoName,
      pull_number: prNumber,
      commit_id: commitSha,
      event: 'COMMENT',
      comments: comments
    });
    
    console.log(`Successfully submitted ${comments.length} JSDoc suggestions`);
  } catch (error) {
    console.error('Error submitting PR review:', error);
  }
}

/**
 * Process a file to generate JSDoc suggestions
 * @param {string} filePath - The path to the file
 */
async function processFile(filePath) {
  console.log(`Processing file: ${filePath}`);
  try {
    const functions = await detectFunctions(filePath);
    
    if (functions.length === 0) {
      console.log(`No functions without JSDoc found in ${filePath}`);
      return;
    }
    
    console.log(`Found ${functions.length} functions without JSDoc in ${filePath}`);
    
    // Get positions in the diff
    const diffPositions = await getDiffPositions(filePath);
    
    // Generate JSDoc suggestions
    const suggestions = [];
    
    for (const func of functions) {
      console.log(`Generating JSDoc for ${func.type} ${func.name}`);
      const jsdocComment = await generateJSDocComment(func.name, func.content, filePath);
      
      if (jsdocComment) {
        const position = diffPositions[func.startLine];
        
        if (position !== undefined) {
          suggestions.push({
            filePath,
            position,
            jsdocComment,
            lineContent: func.lineContent,
            functionName: func.name
          });
          
          stats.totalSuggestions++;
        } else {
          console.log(`Could not find position for line ${func.startLine} in ${filePath}`);
        }
      }
    }
    
    if (suggestions.length > 0) {
      // Submit suggestions as PR review comments
      await submitPRReview(suggestions);
      
      stats.suggestedFiles.push({
        path: filePath,
        suggestionsCount: suggestions.length
      });
    }
    
    return suggestions.length;
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    return 0;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Get list of changed files from environment variable or fallback to all JS/TS files
    let changedFiles = process.env.files ? 
      process.env.files.split(' ') : 
      glob.sync('**/*.{js,jsx,ts,tsx}', { ignore: ['node_modules/**', 'dist/**', 'build/**'] });
    
    if (changedFiles.length === 0) {
      console.log('No JS/TS files to process.');
      return;
    }
    
    stats.totalFiles = changedFiles.length;
    console.log(`Found ${changedFiles.length} files to process`);
    
    for (const file of changedFiles) {
      if (file.trim()) {
        await processFile(file.trim());
      }
    }
    
    // Generate a summary markdown file for the PR comment
    const summary = `
## Summary of JSDoc Suggestions

📊 **Statistics**:
- Total files processed: ${stats.totalFiles}
- Total functions analyzed: ${stats.totalFunctions}
- Total JSDoc suggestions: ${stats.totalSuggestions}
- Files with suggestions: ${stats.suggestedFiles.length}

${stats.suggestedFiles.length > 0 ? `
## Files with JSDoc Suggestions

| File | Suggestions |
|------|-------------|
${stats.suggestedFiles.map(file => `| \`${file.path}\` | ${file.suggestionsCount} |`).join('\n')}
` : ''}

ℹ️ These JSDoc suggestions were automatically generated using AI. 
You can apply them directly by clicking the "Commit suggestion" button on each review comment.
`;
    
    fs.writeFileSync('jsdoc-summary.md', summary);
    console.log('Summary file generated.');
    
  } catch (error) {
    console.error('Error in main function:', error);
    process.exit(1);
  }
}

main();