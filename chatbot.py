import os
import vertexai
import traceback # For detailed error logging
# Import HarmBlockThreshold along with other necessary classes
from vertexai.generative_models import (
    GenerativeModel,
    Part,
    Content,
    GenerationConfig,
    SafetySetting,
    HarmCategory,
    HarmBlockThreshold # <-- Correct import
)
from google.cloud import aiplatform # Ensure google-cloud-aiplatform is installed
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Initialize Vertex AI SDK
try:
    project_id = os.getenv("GOOGLE_PROJECT_ID")
    location = os.getenv("GOOGLE_LOCATION")
    if not project_id or not location:
        raise ValueError("GOOGLE_PROJECT_ID and GOOGLE_LOCATION must be set in .env file")
    vertexai.init(project=project_id, location=location)
    print(f"Vertex AI initialized for project: {project_id} in location: {location}")
except Exception as e:
    print(f"Error initializing Vertex AI: {e}")
    # Handle initialization error appropriately (e.g., exit or raise)
    # For now, let's raise it to stop execution if initialization fails
    raise

# --- CORRECTED safety_settings ---
# Define safety settings using the SafetySetting constructor and HarmBlockThreshold enum
# Note: BLOCK_NONE allows potentially harmful content. Adjust thresholds for production.
# Common thresholds: BLOCK_ONLY_HIGH, BLOCK_MEDIUM_AND_ABOVE, BLOCK_LOW_AND_ABOVE
safety_settings = [
    SafetySetting(
        category=HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold=HarmBlockThreshold.BLOCK_NONE # Use the enum directly
    ),
    SafetySetting(
        category=HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold=HarmBlockThreshold.BLOCK_NONE # Use the enum directly
    ),
    SafetySetting(
        category=HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold=HarmBlockThreshold.BLOCK_NONE # Use the enum directly
    ),
    SafetySetting(
        category=HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold=HarmBlockThreshold.BLOCK_NONE # Use the enum directly
    ),
]
# --- End of Correction ---


def get_gemini_response_stream(model_name: str, user_prompt: str, system_instruction: str, chat_history: list = None):
    """
    Generates content from the Gemini model using streaming.

    Args:
        model_name (str): The name of the Gemini model to use (e.g., "gemini-1.5-flash-001").
        user_prompt (str): The user's input prompt.
        system_instruction (str): System instructions for the model.
        chat_history (list, optional): A list of previous Content objects representing the conversation history. Defaults to None.

    Yields:
        str: Chunks of the generated text or error messages prefixed with [Error].
    """
    try:
        model = GenerativeModel(
            model_name,
            system_instruction=[Part.from_text(system_instruction)] if system_instruction else None
        )

        # Construct the full conversation history including the new user prompt
        conversation = []
        if chat_history:
            # Basic validation of history items
            valid_history = [item for item in chat_history if isinstance(item, Content) and hasattr(item, 'role') and hasattr(item, 'parts')]
            if len(valid_history) != len(chat_history):
                 print("Warning: Some items in provided chat_history were invalid.")
            conversation.extend(valid_history)

        # Ensure the last message is always the new user prompt before sending
        if user_prompt:
             # Make sure parts is a list, even for a single text part
             conversation.append(Content(role="user", parts=[Part.from_text(user_prompt)]))
        else:
             # Do not proceed if there's no user prompt
             print("Error: User prompt is empty.")
             yield "[Error: Cannot generate response without user input]"
             return # Stop execution for this request

        # --- Generation Configuration ---
        generation_config = GenerationConfig(
            temperature=0.2,
            top_p=0.8,
            max_output_tokens=8192, # Increased from 1024
        )

        # Final check: The API requires the conversation to end with a 'user' role message.
        if not conversation or conversation[-1].role != "user":
            print(f"Error: Conversation history does not end with a user message. Last role: {conversation[-1].role if conversation else 'None'}")
            yield "[Internal Error: Invalid conversation history state]"
            return


        # --- Start streaming generation ---
        stream = model.generate_content(
            contents=conversation,
            generation_config=generation_config,
            safety_settings=safety_settings, # Pass the corrected list here
            stream=True
        )

        print("--- Gemini API Call ---")
        print(f"Model: {model_name}")
        print(f"System Instruction: {'Provided' if system_instruction else 'None'}")
        print(f"History Length (Content objects): {len(chat_history) if chat_history else 0}")
        # print(f"User Prompt: {user_prompt[:100]}...") # Avoid printing very long prompts
        print("-----------------------")


        # --- Process the stream ---
        content_generated = False # Flag to track if any text content was yielded
        for chunk in stream:
            # Check for blocked content FIRST
            # Corrected check: finish_reason might indicate safety block.
            finish_reason = None
            safety_ratings_info = "" # Initialize safety ratings info string

            if chunk.candidates and chunk.candidates[0].finish_reason:
                finish_reason = chunk.candidates[0].finish_reason.name
                if finish_reason == "SAFETY":
                    block_reason_message = "Blocked due to SAFETY"
                    # Safety ratings are usually on the candidate when blocked
                    if chunk.candidates[0].safety_ratings:
                        ratings = [f"{rating.category.name}: {rating.probability.name}" for rating in chunk.candidates[0].safety_ratings]
                        safety_ratings_info = f" Details: {'; '.join(ratings)}"
                    print(f"Response blocked. {block_reason_message}{safety_ratings_info}")
                    yield f"[Content Blocked: {block_reason_message}]"
                    return # Stop the generator

                elif finish_reason not in ["STOP", "MAX_TOKENS", "UNSPECIFIED"]: # Log other reasons
                     print(f"Stream finished with reason: {finish_reason}")

            # Check for prompt feedback (can be on early chunks)
            # prompt_feedback is less common for blocking the *response*, usually blocks the prompt itself
            if hasattr(chunk, 'prompt_feedback') and chunk.prompt_feedback.block_reason:
                 block_reason_message = f"Reason: {chunk.prompt_feedback.block_reason.name}" if chunk.prompt_feedback.block_reason else "Reason unspecified."
                 if chunk.prompt_feedback.safety_ratings: # Include details if available
                     ratings = [f"{rating.category.name}: {rating.probability.name}" for rating in chunk.prompt_feedback.safety_ratings]
                     safety_ratings_info = f" Details: {'; '.join(ratings)}"
                 print(f"Prompt blocked. {block_reason_message}{safety_ratings_info}")
                 yield f"[Prompt Blocked: {block_reason_message}]"
                 return # Stop the generator


            # Process text content if available
            try:
                # Primary way to get text
                if hasattr(chunk, 'text') and chunk.text:
                    # print(f"DEBUG chunk.text: {chunk.text}") # Debugging
                    yield chunk.text
                    content_generated = True
                # Fallback: check candidate parts (less common for pure text models but good practice)
                elif hasattr(chunk, 'candidates') and chunk.candidates:
                    for candidate in chunk.candidates:
                         if hasattr(candidate, 'content') and hasattr(candidate.content, 'parts'):
                              for part in candidate.content.parts:
                                   if hasattr(part, 'text') and part.text:
                                        # print(f"DEBUG part.text: {part.text}") # Debugging
                                        yield part.text
                                        content_generated = True
            except ValueError as ve:
                 print(f"ValueError processing chunk: {ve}. Chunk: {chunk}")
                 pass
            except AttributeError as ae:
                 print(f"AttributeError processing chunk: {ae}. Chunk: {chunk}")
                 pass
            except Exception as e:
                print(f"Error processing chunk content: {e}")
                yield f"[Error processing part of the response: {e}]"
                pass

        # If the loop finishes without yielding any text content
        if not content_generated:
            # Check if the finish reason was STOP or MAX_TOKENS, which is normal for empty responses
            if finish_reason not in ["STOP", "MAX_TOKENS"]:
                print(f"Warning: Stream finished (Reason: {finish_reason}), but no text content was generated or yielded.")
                # yield "[No text response received]" # Optional: Send message to user

        # Indicate successful end of stream processing (optional)
        print("--- End of Gemini Stream ---")


    except ValueError as ve:
        # Errors during the initial setup or API call initiation
        print(f"ValueError during generation setup or call: {ve}")
        yield f"[API Configuration Error: {ve}]"
    except Exception as e:
        # Catch-all for other unexpected errors during the process
        print(f"An unexpected error occurred in get_gemini_response_stream: {e}\n{traceback.format_exc()}")
        yield f"[Error: An unexpected error occurred. Please check server logs.]"


# Example usage (optional, for testing chatbot.py directly)
if __name__ == '__main__':
    print("\n--- Testing chatbot module ---")
    test_prompt = "Summarize the top 10 companies and their stock and chart them into an html page. ensure the highest quality and make it visually appeling"
    test_system_instruction = "You are a helpful assistant that can summarize and create HTML pages."
    test_model = os.getenv("DEFAULT_GEMINI_MODEL", "gemini-2.0-flash-001") # Use model from env or default

    print(f"\nSending prompt (History Test): '{test_prompt}'")
    full_response = ""
    try:
        for chunk in get_gemini_response_stream(test_model, test_prompt, test_system_instruction):
            print(chunk, end="", flush=True) # Print chunks as they arrive, flush ensures immediate output
            full_response += chunk
        print("\n--- End of Stream ---")
        # print(f"\nFull response received:\n{full_response}") # Can be very long

    except Exception as e:
        print(f"\nError during testing: {e}")

    # Test without history
    print("\nTesting without history:")
    test_prompt_2 = "Write a short haiku about a rainy day."
    full_response_no_hist = ""
    try:
        for chunk in get_gemini_response_stream(test_model, test_prompt_2, "You are a poet specializing in haiku."):
             print(chunk, end="", flush=True)
             full_response_no_hist += chunk
        print("\n--- End of Stream ---")
        # print(f"\nFull response received:\n{full_response_no_hist}")
    except Exception as e:
         print(f"\nError during testing (no history): {e}")


    print("\n--- Chatbot module test complete ---")