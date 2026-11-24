import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import vueParser from 'vue-eslint-parser'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['src/**/*.{js,jsx,ts,tsx,vue}'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        EventListener: 'readonly'
      }
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      'semi': ['error', 'never'],
      'vue/multi-word-component-names': 'off',
      // import 排序/删除未使用导入统一由 ESLint fix 负责（方案 C），TS 侧 organizeImports 已在 .vscode/settings.json 关闭
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      // @typescript-eslint/no-unused-vars 只报错不自动删，改用 unused-imports 插件（保存时可自动删除）
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
    }
  },
  {
    // 完全忽略所有测试文件的 lint
    ignores: ['**/*.test.ts', '**/*.spec.ts']
  },
  {
    // 无头核心：通用查询引擎必须保持与框架无关，禁止引入 Vue / Pinia / 任何 .vue 组件。
    files: ['src/core/query/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['vue', 'pinia', '*.vue'],
            message: 'src/core/query 必须保持无头（headless），禁止引入 Vue / Pinia / .vue 组件',
          },
        ],
      }],
    },
  }
]
