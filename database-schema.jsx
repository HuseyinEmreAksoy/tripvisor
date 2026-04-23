import React, { useState } from 'react';
import { Database, Users, Map, Calendar, MapPin, Route, Star, Clock, DollarSign, Camera, Share2, Cloud, Plane, Hotel, Utensils, Tag, FileText, Sun, Luggage } from 'lucide-react';

export default function DatabaseSchema() {
  const [activeTab, setActiveTab] = useState('schema');
  const [selectedTable, setSelectedTable] = useState(null);

  const tables = {
    users: {
      name: "users",
      icon: Users,
      color: "blue",
      fields: [
        { name: "id", type: "UUID", pk: true },
        { name: "email", type: "VARCHAR(255)", unique: true },
        { name: "password_hash", type: "VARCHAR(255)" },
        { name: "name", type: "VARCHAR(100)" },
        { name: "avatar_url", type: "TEXT" },
        { name: "preferred_currency", type: "VARCHAR(3)", default: "USD" },
        { name: "preferred_distance_unit", type: "ENUM", values: ["km", "miles"] },
        { name: "home_location", type: "JSONB", note: "{lat, lng, address}" },
        { name: "created_at", type: "TIMESTAMP" },
        { name: "updated_at", type: "TIMESTAMP" }
      ]
    },
    trips: {
      name: "trips",
      icon: Plane,
      color: "green",
      fields: [
        { name: "id", type: "UUID", pk: true },
        { name: "user_id", type: "UUID", fk: "users.id" },
        { name: "title", type: "VARCHAR(255)" },
        { name: "description", type: "TEXT" },
        { name: "cover_image_url", type: "TEXT" },
        { name: "start_date", type: "DATE" },
        { name: "end_date", type: "DATE" },
        { name: "status", type: "ENUM", values: ["draft", "planned", "ongoing", "completed"] },
        { name: "visibility", type: "ENUM", values: ["private", "shared", "public"] },
        { name: "total_budget", type: "DECIMAL(10,2)" },
        { name: "currency", type: "VARCHAR(3)" },
        { name: "created_at", type: "TIMESTAMP" },
        { name: "updated_at", type: "TIMESTAMP" }
      ]
    },
    trip_days: {
      name: "trip_days",
      icon: Calendar,
      color: "purple",
      fields: [
        { name: "id", type: "UUID", pk: true },
        { name: "trip_id", type: "UUID", fk: "trips.id" },
        { name: "day_number", type: "INTEGER" },
        { name: "date", type: "DATE" },
        { name: "title", type: "VARCHAR(255)", note: "e.g. 'Rome City Tour'" },
        { name: "notes", type: "TEXT" },
        { name: "daily_budget", type: "DECIMAL(10,2)" },
        { name: "weather_forecast", type: "JSONB", note: "cached weather data" },
        { name: "created_at", type: "TIMESTAMP" }
      ]
    },
    places: {
      name: "places",
      icon: MapPin,
      color: "red",
      fields: [
        { name: "id", type: "UUID", pk: true },
        { name: "google_place_id", type: "VARCHAR(255)", unique: true },
        { name: "name", type: "VARCHAR(255)" },
        { name: "address", type: "TEXT" },
        { name: "latitude", type: "DECIMAL(10,8)" },
        { name: "longitude", type: "DECIMAL(11,8)" },
        { name: "category", type: "ENUM", values: ["attraction", "restaurant", "hotel", "shopping", "nature", "entertainment", "transport"] },
        { name: "google_rating", type: "DECIMAL(2,1)" },
        { name: "google_reviews_count", type: "INTEGER" },
        { name: "price_level", type: "INTEGER", note: "1-4 scale" },
        { name: "opening_hours", type: "JSONB" },
        { name: "phone", type: "VARCHAR(50)" },
        { name: "website", type: "TEXT" },
        { name: "photos", type: "JSONB", note: "array of photo URLs" },
        { name: "cached_at", type: "TIMESTAMP", note: "for cache invalidation" }
      ]
    },
    trip_stops: {
      name: "trip_stops",
      icon: Route,
      color: "orange",
      fields: [
        { name: "id", type: "UUID", pk: true },
        { name: "trip_day_id", type: "UUID", fk: "trip_days.id" },
        { name: "place_id", type: "UUID", fk: "places.id" },
        { name: "order_index", type: "INTEGER", note: "sequence in day" },
        { name: "planned_arrival", type: "TIME" },
        { name: "planned_departure", type: "TIME" },
        { name: "visit_duration_mins", type: "INTEGER", default: 60 },
        { name: "notes", type: "TEXT" },
        { name: "estimated_cost", type: "DECIMAL(10,2)" },
        { name: "actual_cost", type: "DECIMAL(10,2)" },
        { name: "is_visited", type: "BOOLEAN", default: false },
        { name: "user_rating", type: "INTEGER", note: "1-5 personal rating" },
        { name: "user_review", type: "TEXT" },
        { name: "photos", type: "JSONB", note: "user uploaded photos" }
      ]
    },
    routes: {
      name: "routes",
      icon: Route,
      color: "teal",
      fields: [
        { name: "id", type: "UUID", pk: true },
        { name: "from_stop_id", type: "UUID", fk: "trip_stops.id" },
        { name: "to_stop_id", type: "UUID", fk: "trip_stops.id" },
        { name: "transport_mode", type: "ENUM", values: ["driving", "walking", "transit", "cycling"] },
        { name: "distance_meters", type: "INTEGER" },
        { name: "duration_seconds", type: "INTEGER" },
        { name: "polyline", type: "TEXT", note: "encoded route path" },
        { name: "estimated_cost", type: "DECIMAL(10,2)", note: "fuel/ticket cost" },
        { name: "cached_at", type: "TIMESTAMP" }
      ]
    },
    accommodations: {
      name: "accommodations",
      icon: Hotel,
      color: "indigo",
      fields: [
        { name: "id", type: "UUID", pk: true },
        { name: "trip_id", type: "UUID", fk: "trips.id" },
        { name: "place_id", type: "UUID", fk: "places.id" },
        { name: "check_in_date", type: "DATE" },
        { name: "check_out_date", type: "DATE" },
        { name: "confirmation_number", type: "VARCHAR(100)" },
        { name: "total_cost", type: "DECIMAL(10,2)" },
        { name: "notes", type: "TEXT" },
        { name: "booking_url", type: "TEXT" }
      ]
    },
    trip_collaborators: {
      name: "trip_collaborators",
      icon: Share2,
      color: "pink",
      fields: [
        { name: "id", type: "UUID", pk: true },
        { name: "trip_id", type: "UUID", fk: "trips.id" },
        { name: "user_id", type: "UUID", fk: "users.id" },
        { name: "role", type: "ENUM", values: ["owner", "editor", "viewer"] },
        { name: "invited_at", type: "TIMESTAMP" },
        { name: "accepted_at", type: "TIMESTAMP" }
      ]
    },
    saved_places: {
      name: "saved_places",
      icon: Star,
      color: "yellow",
      fields: [
        { name: "id", type: "UUID", pk: true },
        { name: "user_id", type: "UUID", fk: "users.id" },
        { name: "place_id", type: "UUID", fk: "places.id" },
        { name: "collection_name", type: "VARCHAR(100)", note: "e.g. 'Want to visit'" },
        { name: "notes", type: "TEXT" },
        { name: "created_at", type: "TIMESTAMP" }
      ]
    }
  };

  const additionalFeatures = [
    {
      icon: DollarSign,
      title: "Budget Tracking",
      description: "Track estimated vs actual costs per stop, day, and trip. Split expenses among collaborators.",
      priority: "High"
    },
    {
      icon: Share2,
      title: "Trip Sharing & Collaboration",
      description: "Invite friends to view or edit trips together. Real-time sync for group planning.",
      priority: "High"
    },
    {
      icon: Clock,
      title: "Smart Time Estimation",
      description: "Auto-calculate visit durations based on place type. Warn if day is overpacked.",
      priority: "High"
    },
    {
      icon: Sun,
      title: "Weather Integration",
      description: "Show weather forecast for each day. Suggest indoor alternatives on rainy days.",
      priority: "Medium"
    },
    {
      icon: Hotel,
      title: "Accommodation Tracking",
      description: "Link hotels to specific nights. Show distance from hotel to first/last stop of day.",
      priority: "Medium"
    },
    {
      icon: Utensils,
      title: "Meal Planning",
      description: "Tag stops as breakfast/lunch/dinner. Suggest restaurants near planned attractions.",
      priority: "Medium"
    },
    {
      icon: Camera,
      title: "Trip Journal",
      description: "Add photos and notes to visited places. Auto-generate trip summary/blog.",
      priority: "Medium"
    },
    {
      icon: Luggage,
      title: "Packing Lists",
      description: "Auto-suggest items based on destination, weather, and activities planned.",
      priority: "Low"
    },
    {
      icon: FileText,
      title: "Document Storage",
      description: "Store tickets, reservations, passport copies securely linked to trip.",
      priority: "Low"
    },
    {
      icon: Cloud,
      title: "Offline Mode",
      description: "Download trip data for offline access. Sync when back online.",
      priority: "Low"
    }
  ];

  const getColorClasses = (color) => {
    const colors = {
      blue: { bg: "bg-blue-500", light: "bg-blue-900/30", border: "border-blue-500" },
      green: { bg: "bg-green-500", light: "bg-green-900/30", border: "border-green-500" },
      purple: { bg: "bg-purple-500", light: "bg-purple-900/30", border: "border-purple-500" },
      red: { bg: "bg-red-500", light: "bg-red-900/30", border: "border-red-500" },
      orange: { bg: "bg-orange-500", light: "bg-orange-900/30", border: "border-orange-500" },
      teal: { bg: "bg-teal-500", light: "bg-teal-900/30", border: "border-teal-500" },
      indigo: { bg: "bg-indigo-500", light: "bg-indigo-900/30", border: "border-indigo-500" },
      pink: { bg: "bg-pink-500", light: "bg-pink-900/30", border: "border-pink-500" },
      yellow: { bg: "bg-yellow-500", light: "bg-yellow-900/30", border: "border-yellow-500" }
    };
    return colors[color] || colors.blue;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold flex items-center justify-center gap-3">
            <Database className="w-8 h-8 text-blue-400" />
            Database Schema Design
          </h1>
          <p className="text-gray-400 mt-2">Holiday Route Planner - PostgreSQL Schema</p>
        </div>

        {/* Tabs */}
        <div className="flex justify-center gap-4 mb-6">
          <button
            onClick={() => setActiveTab('schema')}
            className={`px-6 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'schema' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            📊 Schema Diagram
          </button>
          <button
            onClick={() => setActiveTab('relations')}
            className={`px-6 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'relations' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            🔗 Relationships
          </button>
          <button
            onClick={() => setActiveTab('features')}
            className={`px-6 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'features' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            💡 Feature Ideas
          </button>
        </div>

        {/* Schema Tab */}
        {activeTab === 'schema' && (
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(tables).map(([key, table]) => {
              const Icon = table.icon;
              const colors = getColorClasses(table.color);
              return (
                <div
                  key={key}
                  className={`bg-gray-800 rounded-lg overflow-hidden cursor-pointer transition-all hover:scale-102 ${
                    selectedTable === key ? `ring-2 ${colors.border}` : ''
                  }`}
                  onClick={() => setSelectedTable(selectedTable === key ? null : key)}
                >
                  <div className={`${colors.bg} p-3 flex items-center gap-2`}>
                    <Icon className="w-5 h-5" />
                    <span className="font-bold">{table.name}</span>
                  </div>
                  <div className="p-3 space-y-1 text-sm">
                    {table.fields.slice(0, selectedTable === key ? undefined : 5).map((field, i) => (
                      <div key={i} className={`flex items-center gap-2 ${colors.light} px-2 py-1 rounded`}>
                        {field.pk && <span className="text-yellow-400 text-xs">🔑</span>}
                        {field.fk && <span className="text-blue-400 text-xs">🔗</span>}
                        <span className="font-medium">{field.name}</span>
                        <span className="text-gray-400 text-xs ml-auto">{field.type}</span>
                      </div>
                    ))}
                    {selectedTable !== key && table.fields.length > 5 && (
                      <div className="text-gray-500 text-xs text-center pt-1">
                        +{table.fields.length - 5} more fields (click to expand)
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Relations Tab */}
        {activeTab === 'relations' && (
          <div className="bg-gray-800 rounded-lg p-6">
            <div className="grid grid-cols-2 gap-6">
              {/* Visual Relations */}
              <div>
                <h3 className="text-xl font-bold mb-4 text-blue-400">Entity Relationships</h3>
                <div className="space-y-3">
                  <div className="bg-gray-700 p-4 rounded-lg">
                    <div className="flex items-center gap-2 text-lg font-semibold mb-2">
                      <Users className="w-5 h-5 text-blue-400" />
                      <span>User</span>
                      <span className="text-gray-400 mx-2">→</span>
                      <Plane className="w-5 h-5 text-green-400" />
                      <span>Trips</span>
                    </div>
                    <p className="text-sm text-gray-400">One user can have many trips (1:N)</p>
                  </div>
                  
                  <div className="bg-gray-700 p-4 rounded-lg">
                    <div className="flex items-center gap-2 text-lg font-semibold mb-2">
                      <Plane className="w-5 h-5 text-green-400" />
                      <span>Trip</span>
                      <span className="text-gray-400 mx-2">→</span>
                      <Calendar className="w-5 h-5 text-purple-400" />
                      <span>Days</span>
                    </div>
                    <p className="text-sm text-gray-400">One trip has many days (1:N)</p>
                  </div>
                  
                  <div className="bg-gray-700 p-4 rounded-lg">
                    <div className="flex items-center gap-2 text-lg font-semibold mb-2">
                      <Calendar className="w-5 h-5 text-purple-400" />
                      <span>Day</span>
                      <span className="text-gray-400 mx-2">→</span>
                      <Route className="w-5 h-5 text-orange-400" />
                      <span>Stops</span>
                    </div>
                    <p className="text-sm text-gray-400">One day has many stops in order (1:N)</p>
                  </div>
                  
                  <div className="bg-gray-700 p-4 rounded-lg">
                    <div className="flex items-center gap-2 text-lg font-semibold mb-2">
                      <Route className="w-5 h-5 text-orange-400" />
                      <span>Stop</span>
                      <span className="text-gray-400 mx-2">→</span>
                      <MapPin className="w-5 h-5 text-red-400" />
                      <span>Place</span>
                    </div>
                    <p className="text-sm text-gray-400">Each stop references a place (N:1)</p>
                  </div>

                  <div className="bg-gray-700 p-4 rounded-lg">
                    <div className="flex items-center gap-2 text-lg font-semibold mb-2">
                      <Route className="w-5 h-5 text-orange-400" />
                      <span>Stop</span>
                      <span className="text-gray-400 mx-2">↔</span>
                      <Route className="w-5 h-5 text-teal-400" />
                      <span>Route</span>
                    </div>
                    <p className="text-sm text-gray-400">Routes connect consecutive stops (1:1)</p>
                  </div>
                </div>
              </div>

              {/* Relationship Diagram */}
              <div>
                <h3 className="text-xl font-bold mb-4 text-green-400">Data Flow</h3>
                <svg viewBox="0 0 400 350" className="w-full">
                  {/* User */}
                  <rect x="150" y="10" width="100" height="40" rx="5" fill="#3b82f6" />
                  <text x="200" y="35" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">Users</text>
                  
                  {/* Trip */}
                  <rect x="150" y="80" width="100" height="40" rx="5" fill="#22c55e" />
                  <text x="200" y="105" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">Trips</text>
                  
                  {/* Collaborators */}
                  <rect x="280" y="80" width="110" height="40" rx="5" fill="#ec4899" />
                  <text x="335" y="105" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">Collaborators</text>
                  
                  {/* Trip Days */}
                  <rect x="150" y="150" width="100" height="40" rx="5" fill="#a855f7" />
                  <text x="200" y="175" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">Trip Days</text>
                  
                  {/* Accommodations */}
                  <rect x="10" y="150" width="110" height="40" rx="5" fill="#6366f1" />
                  <text x="65" y="175" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">Accommodations</text>
                  
                  {/* Trip Stops */}
                  <rect x="150" y="220" width="100" height="40" rx="5" fill="#f97316" />
                  <text x="200" y="245" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">Trip Stops</text>
                  
                  {/* Routes */}
                  <rect x="280" y="220" width="100" height="40" rx="5" fill="#14b8a6" />
                  <text x="330" y="245" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">Routes</text>
                  
                  {/* Places */}
                  <rect x="150" y="290" width="100" height="40" rx="5" fill="#ef4444" />
                  <text x="200" y="315" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">Places</text>
                  
                  {/* Saved Places */}
                  <rect x="10" y="290" width="110" height="40" rx="5" fill="#eab308" />
                  <text x="65" y="315" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">Saved Places</text>
                  
                  {/* Lines */}
                  <line x1="200" y1="50" x2="200" y2="80" stroke="#666" strokeWidth="2" markerEnd="url(#arrow)" />
                  <line x1="200" y1="120" x2="200" y2="150" stroke="#666" strokeWidth="2" />
                  <line x1="200" y1="190" x2="200" y2="220" stroke="#666" strokeWidth="2" />
                  <line x1="200" y1="260" x2="200" y2="290" stroke="#666" strokeWidth="2" />
                  <line x1="250" y1="100" x2="280" y2="100" stroke="#666" strokeWidth="2" />
                  <line x1="250" y1="240" x2="280" y2="240" stroke="#666" strokeWidth="2" />
                  <line x1="120" y1="170" x2="150" y2="170" stroke="#666" strokeWidth="2" />
                  <line x1="65" y1="290" x2="65" y2="260" stroke="#666" strokeWidth="2" strokeDasharray="5,5" />
                  <line x1="65" y1="260" x2="150" y2="260" stroke="#666" strokeWidth="2" strokeDasharray="5,5" />
                  
                  <defs>
                    <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                      <path d="M0,0 L0,6 L9,3 z" fill="#666" />
                    </marker>
                  </defs>
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* Features Tab */}
        {activeTab === 'features' && (
          <div>
            <div className="grid grid-cols-2 gap-4">
              {additionalFeatures.map((feature, i) => {
                const Icon = feature.icon;
                return (
                  <div key={i} className="bg-gray-800 p-4 rounded-lg flex gap-4">
                    <div className={`p-3 rounded-lg h-fit ${
                      feature.priority === 'High' ? 'bg-green-600' :
                      feature.priority === 'Medium' ? 'bg-yellow-600' : 'bg-gray-600'
                    }`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold">{feature.title}</h4>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          feature.priority === 'High' ? 'bg-green-900 text-green-300' :
                          feature.priority === 'Medium' ? 'bg-yellow-900 text-yellow-300' : 'bg-gray-700 text-gray-300'
                        }`}>
                          {feature.priority}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 mt-1">{feature.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* NoSQL Alternative Note */}
            <div className="mt-6 bg-gray-800 border border-blue-500 rounded-lg p-4">
              <h3 className="font-bold text-blue-400 mb-2">🔄 NoSQL Alternative (MongoDB)</h3>
              <p className="text-sm text-gray-300 mb-3">
                For simpler deployment and flexible schemas, you could use MongoDB with this structure:
              </p>
              <pre className="bg-gray-900 p-3 rounded text-xs overflow-x-auto">
{`// Single "trips" collection with embedded documents
{
  _id: ObjectId,
  userId: ObjectId,
  title: "Italy Adventure",
  days: [
    {
      date: ISODate,
      stops: [
        {
          place: { /* embedded place data */ },
          arrivalTime: "09:00",
          duration: 90,
          routeToNext: { /* embedded route */ }
        }
      ]
    }
  ],
  collaborators: [{ userId, role }],
  accommodations: [{ /* embedded */ }]
}`}
              </pre>
              <p className="text-xs text-gray-400 mt-2">
                ✅ Pros: Faster reads, simpler queries, flexible schema<br/>
                ❌ Cons: Data duplication, harder to update shared places
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
