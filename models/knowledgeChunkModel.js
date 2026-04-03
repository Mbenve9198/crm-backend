import mongoose from 'mongoose';

const knowledgeChunkSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true,
    maxLength: 4000
  },
  category: {
    type: String,
    enum: ['product', 'objection', 'case_study', 'pricing', 'competitor', 'faq', 'conversation_example'],
    required: true,
    index: true
  },
  tags: [{
    type: String,
    index: true
  }],
  source: {
    type: String,
    enum: ['manual', 'conversation', 'website', 'feedback'],
    default: 'manual'
  },
  effectiveness: {
    type: Number,
    default: 0.5,
    min: 0,
    max: 1
  },
  usageCount: { type: Number, default: 0 },
  lastUsed: Date,
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

knowledgeChunkSchema.index({ tags: 1, category: 1, isActive: 1 });

/**
 * Ricerca chunk rilevanti per keyword matching (senza vector search)
 * Fallback per quando Atlas Vector Search non e' configurato
 */
knowledgeChunkSchema.statics.searchByKeywords = function(keywords, category = null, limit = 5) {
  const filter = { isActive: true };
  if (category) filter.category = category;

  if (keywords && keywords.length > 0) {
    filter.$or = [
      { tags: { $in: keywords } },
      { content: { $regex: keywords.join('|'), $options: 'i' } }
    ];
  }

  return this.find(filter)
    .sort({ effectiveness: -1, usageCount: -1 })
    .limit(limit);
};

const KnowledgeChunk = mongoose.model('KnowledgeChunk', knowledgeChunkSchema);

export default KnowledgeChunk;
