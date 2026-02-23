import { z } from "zod";

export const SkillSchema = z.object({
  id: z.string(),
  content: z.string(),
});

export type Skill = z.infer<typeof SkillSchema>;
