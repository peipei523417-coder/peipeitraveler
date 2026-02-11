import { ItineraryItem } from "@/types/travel";

/**
 * Convert time string (HH:mm) to minutes since midnight
 */
export function timeToMinutes(time: string): number {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
}

/**
 * Check if two time ranges overlap
 * Range A: startA - endA
 * Range B: startB - endB
 * They overlap if startA < endB AND startB < endA
 */
export function doTimesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  const startAMins = timeToMinutes(startA);
  const endAMins = timeToMinutes(endA);
  const startBMins = timeToMinutes(startB);
  const endBMins = timeToMinutes(endB);
  
  // Two ranges overlap if one starts before the other ends
  return startAMins < endBMins && startBMins < endAMins;
}

/**
 * Check if a new itinerary item overlaps with any existing items
 * Uses array.some() as requested
 * @param existingItems - array of existing itinerary items
 * @param newStart - start time of new item (HH:mm)
 * @param newEnd - end time of new item (HH:mm)
 * @param excludeItemId - optional item ID to exclude (for editing)
 * @returns the overlapping item if found, null otherwise
 */
export function findOverlappingItem(
  existingItems: ItineraryItem[],
  newStart: string,
  newEnd: string,
  excludeItemId?: string
): ItineraryItem | null {
  // Only check items that have time set
  const itemsWithTime = existingItems.filter(item => item.startTime && item.endTime);
  
  const overlapping = itemsWithTime.find((item) => {
    // Skip the item being edited
    if (excludeItemId && item.id === excludeItemId) return false;
    
    // Check if new time range overlaps with this item
    return doTimesOverlap(newStart, newEnd, item.startTime, item.endTime);
  });
  
  return overlapping || null;
}

/**
 * Check if any existing item has a start_time between the new item's start and end
 * Uses array.some() as specifically requested
 */
export function hasTimeConflict(
  existingItems: ItineraryItem[],
  newStart: string,
  newEnd: string,
  excludeItemId?: string
): boolean {
  // Skip if no time provided
  if (!newStart || !newEnd) return false;
  
  const newStartMins = timeToMinutes(newStart);
  const newEndMins = timeToMinutes(newEnd);
  
  // Only check items that have time set
  const itemsWithTime = existingItems.filter(item => item.startTime && item.endTime);
  
  return itemsWithTime.some((item) => {
    // Skip the item being edited
    if (excludeItemId && item.id === excludeItemId) return false;
    
    const itemStartMins = timeToMinutes(item.startTime);
    const itemEndMins = timeToMinutes(item.endTime);
    
    // Check if new item's start is between existing item's range
    const newStartOverlaps = newStartMins >= itemStartMins && newStartMins < itemEndMins;
    
    // Check if existing item's start is between new item's range
    const existingStartOverlaps = itemStartMins >= newStartMins && itemStartMins < newEndMins;
    
    return newStartOverlaps || existingStartOverlaps;
  });
}
