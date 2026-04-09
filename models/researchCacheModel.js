import mongoose from 'mongoose';

const researchCacheSchema = new mongoose.Schema({
  contactEmail: { type: String, required: true, index: true, unique: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },

  businessData: {
    name: String,
    address: String,
    phone: String,
    rating: Number,
    reviewsCount: Number,
    category: String,
    placeId: String,
    coordinates: { lat: Number, lng: Number },
    website: String,
    priceLevel: String,
  },

  rankingData: {
    keyword: String,
    position: mongoose.Schema.Types.Mixed,
    totalResults: Number,
    topCompetitors: [{
      name: String,
      position: Number,
      reviews: Number,
      rating: Number,
    }],
    checkedAt: Date,
  },

  reviewsData: {
    recentReviews: [{
      author: String,
      rating: Number,
      text: String,
      date: String,
    }],
    averageRating: Number,
    totalCount: Number,
    trend: { type: String, enum: ['improving', 'stable', 'declining'] },
    negativeThemes: [String],
  },

  similarClients: [{
    name: String,
    city: String,
    reviews: Number,
    isMenuchatClient: Boolean,
  }],

  fetchedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
}, { timestamps: true });

researchCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const ResearchCache = mongoose.model('ResearchCache', researchCacheSchema);

export default ResearchCache;
