import {
  array,
  boolean,
  int,
  maximum,
  maxLength,
  minimum,
  minLength,
  multipleOf,
  number,
  object,
  optional,
  positive,
  string,
  trim,
  type infer as zInfer,
} from "zod/mini";
import { omittedAsEmptyString } from "./catalog";

// Retail products and the landing pages' promo strip. A module of their own on purpose: zod/mini
// schemas are top-level calls a bundler cannot prove pure, so every schema in a module the web
// landing page imports (catalog.ts, shop.ts) ships in its main.js. Nothing eager reads these; the
// guests get the strip's text through the shop info (shop.ts).

/** Admin payload for creating/updating a retail product (limits mirror RetailProductRequest/V44). */
export const retailProductSchema = object({
  name: string().check(trim(), minLength(1, "Product name is required"), maxLength(100, "Product name must not exceed 100 characters")),
  sizeLabel: optional(string().check(trim(), maxLength(30, "Size must not exceed 30 characters"))),
  price: number("Price must be a valid number").check(positive("Price must be positive"), maximum(99999999.99, "Price must have at most 8 integer digits and 2 decimals"), multipleOf(0.01, "Price must have at most 8 integer digits and 2 decimals")),
  sortOrder: int("Position must be a whole number").check(minimum(0, "Position must not be negative"), maximum(9999, "Position must not exceed 9999")),
});

export type RetailProductRequest = zInfer<typeof retailProductSchema>;

/** GET /api/v1/catalog/products response item: a retail product (display only, never booked). */
export const retailProductResponseSchema = object({
  id: number(),
  name: string(),
  // The backend omits a missing size (NON_NULL Jackson inclusion).
  sizeLabel: omittedAsEmptyString(),
  price: number(),
  sortOrder: number(),
});

export type RetailProductResponse = zInfer<typeof retailProductResponseSchema>;

/** GET /api/v1/catalog/products response, in the shop's order. */
export const retailProductResponseListSchema = array(retailProductResponseSchema);

/** Owner payload for the landing pages' promo strip; blank turns it off. Mirrors AnnouncementRequest/V45. */
export const announcementSchema = object({
  message: optional(string().check(trim(), maxLength(120, "The announcement must not exceed 120 characters"))),
});

export type AnnouncementRequest = zInfer<typeof announcementSchema>;

/** PUT /api/v1/catalog/announcement response. */
export const announcementResponseSchema = object({
  active: boolean(),
  message: omittedAsEmptyString(),
});

export type AnnouncementResponse = zInfer<typeof announcementResponseSchema>;

