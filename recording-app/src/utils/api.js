const API_BASE_URL = 'https://tl-datacollection-api.onrender.com';
  
export const apiRequest = async (endpoint, options = {}) => {
const baseUrl = API_BASE_URL;
const url = `${baseUrl}${endpoint}`;
console.log('Making API request to:', url);

const response = await fetch(url, options);
if (!response.ok && !options.skipErrorLog) {
    console.error('API request failed:', {
    endpoint,
    status: response.status,
    statusText: response.statusText
    });
}
return response;
};