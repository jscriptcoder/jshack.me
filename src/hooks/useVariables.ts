import { useState, useCallback } from 'react';

type Variable = {
  readonly value: unknown;
  readonly isConst: boolean;
};

type VariableStore = {
  readonly [key: string]: Variable;
};

export type VariableResult = {
  readonly success: boolean;
  readonly value?: unknown;
  readonly error?: string;
};

const CONST_DECLARATION = /^const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(.+)$/;
const LET_DECLARATION = /^let\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(.+)$/;
const REASSIGNMENT = /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(.+)$/;

export const useVariables = () => {
  const [variables, setVariables] = useState<VariableStore>({});

  const getVariables = useCallback(
    (): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(variables).map(([name, variable]) => [name, variable.value]),
      ),
    [variables],
  );

  const getVariableNames = useCallback((): readonly string[] => {
    return Object.keys(variables);
  }, [variables]);

  const parseExpression = useCallback(
    (expression: string, context: Record<string, unknown>): unknown => {
      const contextKeys = Object.keys(context);
      const contextValues = Object.values(context);
      const fn = new Function(...contextKeys, `return ${expression}`);
      return fn(...contextValues);
    },
    [],
  );

  // Intercepts const/let declarations and reassignments before normal command execution.
  // Returns null if the input doesn't match any variable pattern, signaling the caller
  // to fall through to normal command execution via new Function().
  const handleVariableOperation = useCallback(
    (input: string, executionContext: Record<string, unknown>): VariableResult | null => {
      const trimmed = input.trim();

      const constMatch = trimmed.match(CONST_DECLARATION);
      if (constMatch) {
        const [, name, expression] = constMatch;

        if (variables[name] !== undefined) {
          return {
            success: false,
            error: `Identifier '${name}' has already been declared`,
          };
        }

        try {
          const fullContext = { ...executionContext, ...getVariables() };
          const value = parseExpression(expression, fullContext);

          setVariables((prev) => ({
            ...prev,
            [name]: { value, isConst: true },
          }));

          return { success: true, value };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      const letMatch = trimmed.match(LET_DECLARATION);
      if (letMatch) {
        const [, name, expression] = letMatch;

        if (variables[name] !== undefined) {
          return {
            success: false,
            error: `Identifier '${name}' has already been declared`,
          };
        }

        try {
          const fullContext = { ...executionContext, ...getVariables() };
          const value = parseExpression(expression, fullContext);

          setVariables((prev) => ({
            ...prev,
            [name]: { value, isConst: false },
          }));

          return { success: true, value };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      const reassignMatch = trimmed.match(REASSIGNMENT);
      if (reassignMatch) {
        const [, name, expression] = reassignMatch;

        if (variables[name] === undefined) {
          return null;
        }

        if (variables[name].isConst) {
          return {
            success: false,
            error: `Assignment to constant variable '${name}'`,
          };
        }

        try {
          const fullContext = { ...executionContext, ...getVariables() };
          const value = parseExpression(expression, fullContext);

          setVariables((prev) => ({
            ...prev,
            [name]: { ...prev[name], value },
          }));

          return { success: true, value };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      return null;
    },
    [variables, getVariables, parseExpression],
  );

  return {
    variables,
    getVariables,
    getVariableNames,
    handleVariableOperation,
  };
};
