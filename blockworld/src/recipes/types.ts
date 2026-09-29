/** Recipe data structures. Recipes are plain data interpreted by the matcher. */

export interface Ingredient {
  id: number;
  /** Required metadata; undefined accepts any variant. */
  meta?: number;
}

export interface RecipeResult {
  id: number;
  count: number;
  meta?: number;
}

export interface ShapedRecipe {
  type: 'shaped';
  /** Rows of the pattern; space means empty. */
  pattern: string[];
  key: Record<string, Ingredient>;
  result: RecipeResult;
}

export interface ShapelessRecipe {
  type: 'shapeless';
  ingredients: Ingredient[];
  result: RecipeResult;
}

export type Recipe = ShapedRecipe | ShapelessRecipe;

export interface SmeltingRecipe {
  input: Ingredient;
  result: RecipeResult;
  xp: number;
}
