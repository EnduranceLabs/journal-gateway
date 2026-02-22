import { z } from "zod";

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  metadata: z
    .object({
      tags: z.array(z.string()).optional(),
      category: z.string().optional(),
    })
    .optional(),
});

export type Skill = z.infer<typeof SkillSchema>;
