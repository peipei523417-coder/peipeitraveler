export interface TravelProject {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  coverImageUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  itinerary: DayItinerary[];
  isPublic?: boolean;
}

export interface DayItinerary {
  dayNumber: number;
  date: Date;
  items: ItineraryItem[];
}

export interface ItineraryItem {
  id: string;
  startTime: string; // HH:mm format (24-hour)
  endTime: string; // HH:mm format (24-hour)
  description: string;
  googleMapsUrl?: string;
  imageUrl?: string;
  highlightColor?: HighlightColor;
  price?: number; // Budget price in local currency
  persons?: number; // Number of persons (default 1)
  iconType?: TimelineIconType; // Custom timeline marker icon
}

export type TimelineIconType = 
  | 'default'
  | 'heart' 
  | 'utensils' 
  | 'house' 
  | 'star' 
  | 'alert' 
  | 'question'
  | 'car';

export const TIMELINE_ICONS: { value: TimelineIconType; image?: string }[] = [
  { value: 'default' },
  { value: 'heart', image: 'heart' },
  { value: 'utensils', image: 'utensils' },
  { value: 'house', image: 'house' },
  { value: 'star', image: 'star' },
  { value: 'alert', image: 'alert' },
  { value: 'question', image: 'question' },
  { value: 'car', image: 'car' },
];

export type HighlightColor = 
  | 'none'
  | 'yellow' 
  | 'green' 
  | 'blue' 
  | 'pink' 
  | 'purple' 
  | 'orange';

export const HIGHLIGHT_COLORS: { value: HighlightColor; label: string; class: string }[] = [
  { value: 'none', label: '無', class: 'bg-white' },
  { value: 'yellow', label: '黃色', class: 'bg-highlight-yellow' },
  { value: 'green', label: '綠色', class: 'bg-highlight-green' },
  { value: 'blue', label: '藍色', class: 'bg-highlight-blue' },
  { value: 'pink', label: '粉紅', class: 'bg-highlight-pink' },
  { value: 'purple', label: '紫色', class: 'bg-highlight-purple' },
  { value: 'orange', label: '橘色', class: 'bg-highlight-orange' },
];

export interface ProjectFormData {
  name: string;
  startDate: Date;
  endDate: Date;
  coverImageUrl?: string;
  isPublic?: boolean;
  editPassword?: string;
}

// Generate 24-hour time options with 10-minute intervals
export function generateTimeOptions(): string[] {
  const options: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 10) {
      const h = hour.toString().padStart(2, '0');
      const m = minute.toString().padStart(2, '0');
      options.push(`${h}:${m}`);
    }
  }
  return options;
}

export const TIME_OPTIONS = generateTimeOptions();
