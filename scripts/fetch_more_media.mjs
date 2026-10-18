import "../meta/env.js";
import { get } from "../meta/graph.js";

const ids = [
  "18195789049347910", // Shreyansh Sinha 85.28% result
  "18106223459189264", // Diwa AI robot
  "17956877013012417", // Kaash... testimonial/results theme
  "18130901581667578", // foundation check
  "18086206040482302", // Real students real progress
  "17937197595367628", // Teachers Day
];

for (const id of ids) {
  try {
    const m = await get(`/${id}`, { fields: "media_type,media_product_type,media_url,thumbnail_url,caption" });
    console.log(JSON.stringify({ id, ...m }));
  } catch (e) {
    console.log(JSON.stringify({ id, error: e.message }));
  }
}
