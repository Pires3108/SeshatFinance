import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const portable = (value) => value.replaceAll('\\', '/');
const relative = (value) => portable(path.relative(root, value));

function targetPath(filename, source) {
  if (source.startsWith('.'))
    return relative(path.resolve(path.dirname(filename), source));
  if (source.startsWith('@seshat/'))
    return source.replace('@seshat/', 'packages/');
  return source;
}

const boundaries = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden:
        'Architecture boundary forbids importing {{source}} from {{layer}}.',
      repository:
        'Use the public module API instead of another module internal repository ({{source}}).',
    },
  },
  create(context) {
    const file = relative(context.filename);
    function check(node, source) {
      if (typeof source !== 'string') return;
      const target = targetPath(context.filename, source);
      const domain = file.startsWith('packages/domain/');
      const application = file.startsWith('packages/application/');
      const web = file.startsWith('apps/web/');
      const forbiddenFramework =
        /^(?:@nestjs\/|@prisma\/|prisma(?:\/|$)|next(?:\/|$)|react(?:\/|$))/u.test(
          source,
        );
      const forbiddenPackage = domain
        ? /^packages\/(?:application|contracts|database|observability)(?:\/|$)|^apps\//u.test(
            target,
          )
        : application
          ? /^packages\/(?:database|observability)(?:\/|$)|^apps\//u.test(
              target,
            )
          : web &&
            /^packages\/(?:domain|application|database)(?:\/|$)/u.test(target);
      if (forbiddenPackage || ((domain || application) && forbiddenFramework)) {
        context.report({
          node,
          messageId: 'forbidden',
          data: {
            source,
            layer: domain ? 'Domain' : application ? 'Application' : 'Web',
          },
        });
        return;
      }
      const owner = /^packages\/database\/src\/([^/]+)\//u.exec(file)?.[1];
      const targetOwner = /^packages\/database\/src\/([^/]+)\//u.exec(
        target,
      )?.[1];
      const test = /\.(?:spec|test)\.tsx?$/u.test(file);
      if (
        !test &&
        owner &&
        targetOwner &&
        owner !== targetOwner &&
        /repository(?:\.[cm]?[jt]s)?$/u.test(target)
      ) {
        context.report({ node, messageId: 'repository', data: { source } });
      }
    }
    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        check(node, node.source.value);
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require')
          check(node, node.arguments[0]?.value);
      },
      TSImportType(node) {
        check(node, node.argument?.value ?? node.argument?.literal?.value);
      },
    };
  },
};

const preciseMoney = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      number:
        'Monetary values and precision-sensitive rates must use Money, bigint, or decimal strings with explicit currency, never number.',
    },
  },
  create(context) {
    return {
      TSNumberKeyword(node) {
        let annotation = node.parent;
        while (
          annotation &&
          annotation.type !== 'TSTypeAnnotation' &&
          annotation.type !== 'TSTypeAliasDeclaration'
        ) {
          annotation = annotation.parent;
        }
        const owner =
          annotation?.type === 'TSTypeAliasDeclaration'
            ? annotation
            : annotation?.parent;
        const name =
          owner?.name ??
          owner?.key?.name ??
          owner?.key?.value ??
          owner?.id?.name;
        if (
          typeof name === 'string' &&
          /^(?:amount|balance|principal|fee|price|total|interestRate|exchangeRate|conversionRate)$|(?:Money|Amount|Balance|Price|Rate)$/u.test(
            name,
          )
        ) {
          context.report({ node, messageId: 'number' });
        }
      },
    };
  },
};

export default { rules: { boundaries, 'precise-money': preciseMoney } };
